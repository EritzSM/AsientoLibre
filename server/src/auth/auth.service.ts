import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';

export interface AuthResponse {
  message: string;
  access_token: string | null;
  refresh_token: string | null;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    nationalId?: string;
    email: string;
    role: 'pasajero' | 'conductor';
    skipVehicle?: boolean;
    vehicle?: {
      brand: string;
      model: string;
      color: string;
      plate: string;
    };
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Registra un nuevo usuario en Supabase Auth y guarda su perfil en public.profiles y public.vehicles
   */
  async register(registerDto: RegisterDto): Promise<AuthResponse> {
    if (!this.supabaseService.isConfigured()) {
      throw new BadRequestException(
        'Supabase no está configurado en el servidor. Por favor configura SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_ANON_KEY) en server/.env',
      );
    }

    const supabase = this.supabaseService.getClient();
    let userId: string | null = null;
    let sessionToken: string | null = null;
    let refreshToken: string | null = null;

    // 1. Intentar crear usuario mediante Admin API (confirma correo automáticamente si tiene service_role)
    try {
      const { data: adminData, error: adminError } = await supabase.auth.admin.createUser({
        email: registerDto.email,
        password: registerDto.password,
        email_confirm: true,
        user_metadata: {
          firstName: registerDto.firstName,
          lastName: registerDto.lastName,
          nationalId: registerDto.nationalId,
          role: registerDto.role,
        },
      });

      if (!adminError && adminData.user) {
        userId = adminData.user.id;
        this.logger.log(`Usuario creado vía Supabase Admin API: ${userId}`);

        // Iniciar sesión para obtener los tokens
        const { data: loginData } = await supabase.auth.signInWithPassword({
          email: registerDto.email,
          password: registerDto.password,
        });

        if (loginData?.session) {
          sessionToken = loginData.session.access_token;
          refreshToken = loginData.session.refresh_token;
        }
      } else if (adminError) {
        this.logger.debug(`Fallo createUser admin (${adminError.message}), intentando signUp público...`);
      }
    } catch {
      this.logger.debug('Admin API no disponible, usando signUp público...');
    }

    // Si no se creó con admin, usar signUp tradicional
    if (!userId) {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: registerDto.email,
        password: registerDto.password,
        options: {
          data: {
            firstName: registerDto.firstName,
            lastName: registerDto.lastName,
            nationalId: registerDto.nationalId,
            role: registerDto.role,
          },
        },
      });

      if (signUpError) {
        this.logger.error(`Error en signUp: ${signUpError.message}`);
        if (signUpError.message.toLowerCase().includes('already registered') || signUpError.message.toLowerCase().includes('duplicate')) {
          throw new BadRequestException('El correo electrónico ya se encuentra registrado');
        }
        throw new BadRequestException(`Error al registrar el usuario: ${signUpError.message}`);
      }

      if (!signUpData.user) {
        throw new BadRequestException('No se pudo crear la cuenta de usuario');
      }

      userId = signUpData.user.id;
      sessionToken = signUpData.session?.access_token ?? null;
      refreshToken = signUpData.session?.refresh_token ?? null;
    }

    // 2. Insertar o actualizar registro en public.profiles
    const { error: profileError } = await supabase.from('profiles').upsert(
      {
        id: userId,
        first_name: registerDto.firstName,
        last_name: registerDto.lastName,
        national_id: registerDto.nationalId,
        role: registerDto.role,
      },
      { onConflict: 'id' },
    );

    if (profileError) {
      this.logger.error(`Error al crear perfil en public.profiles: ${profileError.message}`);
      // Nota: no bloqueamos el registro si las tablas aún no se han creado en Supabase,
      // pero dejamos el log para que el administrador revise la ejecución de schema.sql
    }

    // 3. Si el rol es conductor y proporcionó datos del vehículo
    let vehicleData = undefined;
    if (registerDto.role === 'conductor' && !registerDto.skipVehicle && registerDto.vehicle) {
      const { error: vehicleError } = await supabase.from('vehicles').upsert(
        {
          user_id: userId,
          brand: registerDto.vehicle.brand,
          model: registerDto.vehicle.model,
          color: registerDto.vehicle.color,
          plate: registerDto.vehicle.plate.toUpperCase(),
        },
        { onConflict: 'user_id' },
      );

      if (vehicleError) {
        this.logger.error(`Error al registrar vehículo en public.vehicles: ${vehicleError.message}`);
      } else {
        vehicleData = {
          brand: registerDto.vehicle.brand,
          model: registerDto.vehicle.model,
          color: registerDto.vehicle.color,
          plate: registerDto.vehicle.plate.toUpperCase(),
        };
      }
    }

    return {
      message: 'Usuario registrado exitosamente',
      access_token: sessionToken,
      refresh_token: refreshToken,
      user: {
        id: userId,
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        nationalId: registerDto.nationalId,
        email: registerDto.email,
        role: registerDto.role,
        skipVehicle: registerDto.skipVehicle,
        vehicle: vehicleData ?? registerDto.vehicle,
      },
    };
  }

  /**
   * Inicia sesión con correo y contraseña en Supabase Auth
   */
  async login(loginDto: LoginDto): Promise<AuthResponse> {
    if (!this.supabaseService.isConfigured()) {
      throw new BadRequestException(
        'Supabase no está configurado en el servidor. Por favor configura SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_ANON_KEY) en server/.env',
      );
    }

    const supabase = this.supabaseService.getClient();

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: loginDto.email,
      password: loginDto.password,
    });

    if (authError || !authData.user || !authData.session) {
      this.logger.warn(`Intento de login fallido para ${loginDto.email}: ${authError?.message}`);
      throw new UnauthorizedException('Correo electrónico o contraseña incorrectos');
    }

    const user = authData.user;
    const session = authData.session;

    // Obtener información adicional de perfil en public.profiles
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    // Obtener vehículo si existe
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('brand, model, color, plate')
      .eq('user_id', user.id)
      .maybeSingle();

    const firstName =
      profile?.first_name ||
      user.user_metadata?.firstName ||
      (user.email ? user.email.split('@')[0] : 'Usuario');
    const lastName = profile?.last_name || user.user_metadata?.lastName || '';
    const nationalId = profile?.national_id || user.user_metadata?.nationalId || '';
    const role = profile?.role || user.user_metadata?.role || 'pasajero';

    return {
      message: 'Inicio de sesión exitoso',
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      user: {
        id: user.id,
        firstName,
        lastName,
        nationalId,
        email: user.email ?? loginDto.email,
        role,
        vehicle: vehicle
          ? {
              brand: vehicle.brand,
              model: vehicle.model,
              color: vehicle.color,
              plate: vehicle.plate,
            }
          : undefined,
      },
    };
  }

  /**
   * Obtiene la información del usuario autenticado mediante su token Bearer
   */
  async getMe(token: string): Promise<AuthResponse['user']> {
    if (!this.supabaseService.isConfigured()) {
      throw new BadRequestException('Supabase no está configurado en el servidor');
    }

    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      throw new UnauthorizedException('Token no válido o sesión expirada');
    }

    const user = data.user;

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('brand, model, color, plate')
      .eq('user_id', user.id)
      .maybeSingle();

    return {
      id: user.id,
      firstName: profile?.first_name || user.user_metadata?.firstName || 'Usuario',
      lastName: profile?.last_name || user.user_metadata?.lastName || '',
      nationalId: profile?.national_id || user.user_metadata?.nationalId || '',
      email: user.email || '',
      role: profile?.role || user.user_metadata?.role || 'pasajero',
      vehicle: vehicle
        ? {
            brand: vehicle.brand,
            model: vehicle.model,
            color: vehicle.color,
            plate: vehicle.plate,
          }
        : undefined,
    };
  }
}

