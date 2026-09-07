import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import { EmailService } from '../email/email.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { randomUUID } from 'crypto';

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
    isActive: boolean;
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

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Registra un nuevo usuario: valida correo, verifica unicidad, genera token
   * de activación y guarda el usuario con is_active = false
   */
  async register(registerDto: RegisterDto): Promise<AuthResponse> {
    if (!this.supabaseService.isConfigured()) {
      throw new BadRequestException(
        'Supabase no está configurado en el servidor. Por favor configura SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_ANON_KEY) en server/.env',
      );
    }

    // 1. Validar formato de correo (class-validator ya valida en el DTO, pero doble verificación)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(registerDto.email)) {
      throw new BadRequestException('El correo electrónico no tiene un formato válido');
    }

    const supabase = this.supabaseService.getClient();
    let userId: string | null = null;

    // 2. Verificar si el correo ya existe en auth.users
    try {
      const { data: existingUsers } = await supabase.auth.admin.listUsers();
      if (existingUsers?.users?.some((u) => u.email === registerDto.email)) {
        throw new BadRequestException('El correo electrónico ya se encuentra registrado');
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.debug('No se pudo verificar correo existente vía admin, continuando...');
    }

    // 3. Generar token de activación y fecha de expiración (24 horas)
    const activationToken = randomUUID();
    const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // 4. Crear usuario en Supabase Auth (sin confirmación automática, se gestiona manualmente)
    try {
      const { data: adminData, error: adminError } = await supabase.auth.admin.createUser({
        email: registerDto.email,
        password: registerDto.password,
        email_confirm: true, // Supabase auth confirma, la activación custom es en profiles
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
      } else if (adminError) {
        this.logger.debug(`Fallo createUser admin (${adminError.message}), intentando signUp público...`);
      }
    } catch {
      this.logger.debug('Admin API no disponible, usando signUp público...');
    }

    // Fallback: signUp tradicional
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
        if (
          signUpError.message.toLowerCase().includes('already registered') ||
          signUpError.message.toLowerCase().includes('duplicate')
        ) {
          throw new BadRequestException('El correo electrónico ya se encuentra registrado');
        }
        throw new BadRequestException(`Error al registrar el usuario: ${signUpError.message}`);
      }

      if (!signUpData.user) {
        throw new BadRequestException('No se pudo crear la cuenta de usuario');
      }

      userId = signUpData.user.id;
    }

    // 5. Guardar en public.profiles con is_active = false, token y expiración
    const { error: profileError } = await supabase.from('profiles').upsert(
      {
        id: userId,
        first_name: registerDto.firstName,
        last_name: registerDto.lastName,
        national_id: registerDto.nationalId,
        role: registerDto.role,
        is_active: false,
        activation_token: activationToken,
        token_expires_at: tokenExpiresAt,
      },
      { onConflict: 'id' },
    );

    if (profileError) {
      this.logger.error(`Error al crear perfil en public.profiles: ${profileError.message}`);
    }

    // 6. Si es conductor y proporcionó datos del vehículo
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

    // 7. Enviar correo de activación con Resend
    await this.emailService.sendActivationEmail(
      registerDto.email,
      registerDto.firstName,
      activationToken,
    );

    return {
      message:
        'Cuenta creada exitosamente. Hemos enviado un correo de verificación a tu dirección de email. Por favor revisa tu bandeja de entrada y spam.',
      access_token: null, // No se da acceso hasta verificar el correo
      refresh_token: null,
      user: {
        id: userId,
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        nationalId: registerDto.nationalId,
        email: registerDto.email,
        role: registerDto.role,
        isActive: false,
        skipVehicle: registerDto.skipVehicle,
        vehicle: vehicleData ?? registerDto.vehicle,
      },
    };
  }

  /**
   * Verifica el token de activación del correo
   * Retorna una URL de redirección para el controlador (flujo desde link en email)
   */
  async verifyEmail(token: string): Promise<{ success: boolean; redirectUrl: string }> {
    if (!this.supabaseService.isConfigured()) {
      throw new BadRequestException('Supabase no está configurado en el servidor');
    }

    const supabase = this.supabaseService.getClient();

    // Buscar usuario por activation_token
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, is_active, token_expires_at, first_name')
      .eq('activation_token', token)
      .maybeSingle();

    if (error) {
      this.logger.error(`Error al buscar token de activación: ${error.message}`);
    }

    // Obtener frontendUrl para redirecciones
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

    // Token no existe
    if (!profile) {
      return {
        success: false,
        redirectUrl: `${frontendUrl}/login.html?error=invalid_token`,
      };
    }

    // Ya está activo (token reutilizado)
    if (profile.is_active) {
      return {
        success: true,
        redirectUrl: `${frontendUrl}/login.html?activated=true`,
      };
    }

    // Verificar si el token ha expirado
    const now = new Date();
    const expiresAt = profile.token_expires_at ? new Date(profile.token_expires_at) : null;

    if (!expiresAt || expiresAt < now) {
      return {
        success: false,
        redirectUrl: `${frontendUrl}/login.html?error=expired_token`,
      };
    }

    // Token válido: activar usuario y limpiar token
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        is_active: true,
        activation_token: null,
        token_expires_at: null,
      })
      .eq('id', profile.id);

    if (updateError) {
      this.logger.error(`Error al activar perfil ${profile.id}: ${updateError.message}`);
      return {
        success: false,
        redirectUrl: `${frontendUrl}/login.html?error=server_error`,
      };
    }

    this.logger.log(`Cuenta activada exitosamente para perfil: ${profile.id}`);
    return {
      success: true,
      redirectUrl: `${frontendUrl}/login.html?activated=true`,
    };
  }

  /**
   * Reenvía el correo de verificación generando un nuevo token
   */
  async resendVerification(email: string): Promise<{ message: string }> {
    if (!this.supabaseService.isConfigured()) {
      throw new BadRequestException('Supabase no está configurado en el servidor');
    }

    const supabase = this.supabaseService.getClient();

    // Buscar usuario en auth.users por correo
    let userId: string | null = null;
    let firstName = 'Usuario';

    try {
      const { data: users } = await supabase.auth.admin.listUsers();
      const found = users?.users?.find((u) => u.email === email);
      if (found) {
        userId = found.id;
        firstName = found.user_metadata?.firstName || 'Usuario';
      }
    } catch {
      this.logger.debug('No se pudo buscar usuario vía admin API');
    }

    if (!userId) {
      // Respuesta genérica por seguridad (no revelar si existe o no)
      return {
        message:
          'Si el correo está registrado y pendiente de verificación, recibirás un nuevo enlace de activación.',
      };
    }

    // Verificar que el perfil existe y no esté ya activo
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_active, first_name')
      .eq('id', userId)
      .maybeSingle();

    if (!profile) {
      return {
        message:
          'Si el correo está registrado y pendiente de verificación, recibirás un nuevo enlace de activación.',
      };
    }

    if (profile.is_active) {
      throw new BadRequestException('Este correo ya ha sido verificado. Puedes iniciar sesión normalmente.');
    }

    firstName = profile.first_name || firstName;

    // Generar nuevo token y nueva expiración
    const newToken = randomUUID();
    const newExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        activation_token: newToken,
        token_expires_at: newExpiry,
      })
      .eq('id', userId);

    if (updateError) {
      this.logger.error(`Error al actualizar token para ${email}: ${updateError.message}`);
      throw new BadRequestException('No se pudo reenviar el correo de verificación. Intenta nuevamente.');
    }

    await this.emailService.sendActivationEmail(email, firstName, newToken);

    return {
      message:
        'Correo de verificación reenviado exitosamente. Revisa tu bandeja de entrada y también la carpeta de spam.',
    };
  }

  /**
   * Permite a un usuario no verificado corregir su correo electrónico
   */
  async changeUnverifiedEmail(currentEmail: string, newEmail: string): Promise<{ message: string }> {
    if (!this.supabaseService.isConfigured()) {
      throw new BadRequestException('Supabase no está configurado en el servidor');
    }

    // Validar formato del nuevo correo
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      throw new BadRequestException('El nuevo correo electrónico no tiene un formato válido');
    }

    if (currentEmail.toLowerCase() === newEmail.toLowerCase()) {
      throw new BadRequestException('El nuevo correo debe ser diferente al actual');
    }

    const supabase = this.supabaseService.getClient();

    // Buscar usuario por correo actual
    let userId: string | null = null;
    try {
      const { data: users } = await supabase.auth.admin.listUsers();
      const found = users?.users?.find((u) => u.email === currentEmail);
      if (found) userId = found.id;
    } catch {
      this.logger.debug('No se pudo verificar correo vía admin API');
    }

    if (!userId) {
      throw new NotFoundException('No se encontró una cuenta con ese correo electrónico');
    }

    // Verificar que el usuario no esté ya activo
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_active, first_name')
      .eq('id', userId)
      .maybeSingle();

    if (profile?.is_active) {
      throw new BadRequestException('Esta cuenta ya está verificada. No es posible cambiar el correo de esta manera.');
    }

    // Verificar que el nuevo correo no esté ya en uso
    try {
      const { data: users } = await supabase.auth.admin.listUsers();
      if (users?.users?.some((u) => u.email === newEmail)) {
        throw new BadRequestException('El nuevo correo electrónico ya está registrado en otra cuenta');
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
    }

    // Actualizar correo en Supabase Auth
    const { error: authUpdateError } = await supabase.auth.admin.updateUserById(userId, {
      email: newEmail,
    });

    if (authUpdateError) {
      this.logger.error(`Error al actualizar correo en auth: ${authUpdateError.message}`);
      throw new BadRequestException('No se pudo actualizar el correo. Por favor intenta nuevamente.');
    }

    // Generar nuevo token y expiración
    const newToken = randomUUID();
    const newExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const firstName = profile?.first_name || 'Usuario';

    const { error: profileUpdateError } = await supabase
      .from('profiles')
      .update({
        activation_token: newToken,
        token_expires_at: newExpiry,
      })
      .eq('id', userId);

    if (profileUpdateError) {
      this.logger.error(`Error al actualizar token tras cambio de correo: ${profileUpdateError.message}`);
    }

    await this.emailService.sendActivationEmail(newEmail, firstName, newToken);

    return {
      message: `Correo actualizado a ${newEmail}. Hemos enviado un nuevo enlace de verificación a tu nueva dirección.`,
    };
  }

  /**
   * Inicia sesión con correo y contraseña
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

    // Obtener perfil de public.profiles (incluye is_active)
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
    const isActive = profile?.is_active ?? false;

    return {
      message: isActive ? 'Inicio de sesión exitoso' : 'Inicio de sesión exitoso — correo pendiente de verificación',
      access_token: isActive ? session.access_token : null,
      refresh_token: isActive ? session.refresh_token : null,
      user: {
        id: user.id,
        firstName,
        lastName,
        nationalId,
        email: user.email ?? loginDto.email,
        role,
        isActive,
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
      isActive: profile?.is_active ?? false,
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

  /**
   * Solicita el cambio de correo electrónico enviando un código de 6 dígitos al nuevo correo.
   * Valida que el nuevo correo no esté ya en uso en otra cuenta.
   */
  async requestEmailChange(
    currentEmail: string,
    newEmail: string,
  ): Promise<{ success: boolean; message: string; pendingEmail: string }> {
    if (!this.supabaseService.isConfigured()) {
      throw new BadRequestException('Supabase no está configurado en el servidor');
    }

    const curr = currentEmail.trim().toLowerCase();
    const next = newEmail.trim().toLowerCase();

    if (curr === next) {
      throw new BadRequestException('El nuevo correo electrónico es idéntico al actual.');
    }

    const supabase = this.supabaseService.getClient();

    // 1. Verificar si el nuevo correo ya existe en Supabase Auth
    const { data: listData, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) {
      this.logger.error(`Error al listar usuarios para validación de correo: ${listError.message}`);
    }

    const users = listData?.users || [];
    const existingTarget = users.find((u) => u.email?.toLowerCase() === next);
    if (existingTarget) {
      throw new BadRequestException('El correo electrónico ingresado ya se encuentra registrado por otro usuario.');
    }

    // 2. Localizar al usuario actual
    const currentUser = users.find((u) => u.email?.toLowerCase() === curr);
    if (!currentUser) {
      throw new NotFoundException('No se encontró el usuario actual en el sistema.');
    }

    // 3. Generar código de 6 dígitos numérico y expiración de 15 minutos
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // 4. Guardar solicitud pendiente en public.profiles
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        pending_email: next,
        email_change_code: code,
        email_change_expires_at: expiresAt,
      })
      .eq('id', currentUser.id);

    if (updateError) {
      this.logger.error(`Error al guardar solicitud de cambio de correo: ${updateError.message}`);
      throw new BadRequestException(`No se pudo registrar la solicitud: ${updateError.message}`);
    }

    // 5. Obtener nombre del usuario y enviar código por Brevo
    const firstName = currentUser.user_metadata?.firstName || 'Usuario';
    await this.emailService.sendEmailChangeCode(next, firstName, code);

    this.logger.log(`Código de cambio de correo enviado a ${next} para el usuario ${currentUser.id}`);

    return {
      success: true,
      message: `Hemos enviado un código de 6 dígitos a ${next}. Por favor ingrésalo para confirmar el cambio.`,
      pendingEmail: next,
    };
  }

  /**
   * Confirma el cambio de correo electrónico verificando el código de 6 dígitos.
   */
  async confirmEmailChange(
    currentEmail: string,
    code: string,
  ): Promise<{ success: boolean; message: string; newEmail: string }> {
    if (!this.supabaseService.isConfigured()) {
      throw new BadRequestException('Supabase no está configurado en el servidor');
    }

    const curr = currentEmail.trim().toLowerCase();
    const cleanCode = code.trim();

    const supabase = this.supabaseService.getClient();

    // 1. Localizar usuario actual
    const { data: listData } = await supabase.auth.admin.listUsers();
    const users = listData?.users || [];
    const currentUser = users.find((u) => u.email?.toLowerCase() === curr);

    if (!currentUser) {
      throw new NotFoundException('No se encontró el usuario actual en el sistema.');
    }

    // 2. Obtener datos pendientes de profiles
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, first_name, pending_email, email_change_code, email_change_expires_at')
      .eq('id', currentUser.id)
      .maybeSingle();

    if (profileError || !profile) {
      throw new NotFoundException('Perfil de usuario no encontrado.');
    }

    if (!profile.pending_email || !profile.email_change_code) {
      throw new BadRequestException('No existe ninguna solicitud de cambio de correo pendiente.');
    }

    // 3. Validar código
    if (profile.email_change_code !== cleanCode) {
      throw new BadRequestException('El código de verificación es incorrecto.');
    }

    // 4. Validar expiración
    if (!profile.email_change_expires_at || new Date(profile.email_change_expires_at) < new Date()) {
      throw new BadRequestException('El código de verificación ha expirado. Por favor solicita un nuevo código.');
    }

    const targetEmail = profile.pending_email.trim().toLowerCase();

    // 5. Verificar que el correo no fue tomado mientras tanto
    const alreadyTaken = users.some(
      (u) => u.id !== currentUser.id && u.email?.toLowerCase() === targetEmail,
    );
    if (alreadyTaken) {
      throw new BadRequestException('El nuevo correo electrónico ya fue registrado por otra cuenta.');
    }

    // 6. Actualizar el email en Supabase Auth
    const { error: updateAuthError } = await supabase.auth.admin.updateUserById(
      currentUser.id,
      {
        email: targetEmail,
        email_confirm: true,
      },
    );

    if (updateAuthError) {
      this.logger.error(`Error al actualizar email en Supabase Auth: ${updateAuthError.message}`);
      throw new BadRequestException(`Error al actualizar el correo en autenticación: ${updateAuthError.message}`);
    }

    // 7. Limpiar campos de solicitud pendiente en public.profiles
    const { error: clearError } = await supabase
      .from('profiles')
      .update({
        pending_email: null,
        email_change_code: null,
        email_change_expires_at: null,
      })
      .eq('id', currentUser.id);

    if (clearError) {
      this.logger.error(`Error al limpiar solicitud pendiente en profiles: ${clearError.message}`);
    }

    this.logger.log(`Correo del usuario ${currentUser.id} actualizado exitosamente a ${targetEmail}`);

    return {
      success: true,
      message: '¡Tu correo electrónico ha sido actualizado exitosamente!',
      newEmail: targetEmail,
    };
  }

  /**
   * Cancela la solicitud pendiente de cambio de correo electrónico.
   */
  async cancelEmailChange(
    currentEmail: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!this.supabaseService.isConfigured()) {
      throw new BadRequestException('Supabase no está configurado en el servidor');
    }

    const curr = currentEmail.trim().toLowerCase();
    const supabase = this.supabaseService.getClient();

    const { data: listData } = await supabase.auth.admin.listUsers();
    const users = listData?.users || [];
    const currentUser = users.find((u) => u.email?.toLowerCase() === curr);

    if (!currentUser) {
      throw new NotFoundException('No se encontró el usuario actual en el sistema.');
    }

    // Limpiar campos pendientes
    await supabase
      .from('profiles')
      .update({
        pending_email: null,
        email_change_code: null,
        email_change_expires_at: null,
      })
      .eq('id', currentUser.id);

    this.logger.log(`Solicitud de cambio de correo cancelada para el usuario ${currentUser.id}`);

    return {
      success: true,
      message: 'La solicitud de cambio de correo ha sido cancelada.',
    };
  }

  /**
   * Reenvía un nuevo código de 6 dígitos al correo pendiente.
   */
  async resendEmailChangeCode(
    currentEmail: string,
  ): Promise<{ success: boolean; message: string; pendingEmail: string }> {
    if (!this.supabaseService.isConfigured()) {
      throw new BadRequestException('Supabase no está configurado en el servidor');
    }

    const curr = currentEmail.trim().toLowerCase();
    const supabase = this.supabaseService.getClient();

    const { data: listData } = await supabase.auth.admin.listUsers();
    const users = listData?.users || [];
    const currentUser = users.find((u) => u.email?.toLowerCase() === curr);

    if (!currentUser) {
      throw new NotFoundException('No se encontró el usuario actual en el sistema.');
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('pending_email, first_name')
      .eq('id', currentUser.id)
      .maybeSingle();

    if (!profile?.pending_email) {
      throw new BadRequestException('No hay ninguna solicitud de cambio de correo pendiente.');
    }

    const newCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await supabase
      .from('profiles')
      .update({
        email_change_code: newCode,
        email_change_expires_at: expiresAt,
      })
      .eq('id', currentUser.id);

    const firstName = profile.first_name || currentUser.user_metadata?.firstName || 'Usuario';
    await this.emailService.sendEmailChangeCode(profile.pending_email, firstName, newCode);

    return {
      success: true,
      message: `Nuevo código de verificación enviado a ${profile.pending_email}.`,
      pendingEmail: profile.pending_email,
    };
  }

  /**
   * Actualiza los datos del perfil (nombre, cédula, rol y vehículo) en Supabase.
   */
  async updateProfile(
    userId: string,
    data: {
      firstName: string;
      lastName: string;
      nationalId: string;
      role: 'pasajero' | 'conductor';
      vehicle?: { brand: string; model: string; color: string; plate: string };
    },
  ): Promise<{ success: boolean; message: string }> {
    if (!this.supabaseService.isConfigured()) {
      throw new BadRequestException('Supabase no está configurado en el servidor');
    }

    const supabase = this.supabaseService.getClient();

    // 1. Actualizar public.profiles
    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        first_name: data.firstName,
        last_name: data.lastName,
        national_id: data.nationalId,
        role: data.role,
      })
      .eq('id', userId);

    if (profileError) {
      throw new BadRequestException(`Error al actualizar perfil: ${profileError.message}`);
    }

    // 2. Gestionar vehículo si aplica
    if (data.role === 'conductor' && data.vehicle) {
      await supabase.from('vehicles').upsert(
        {
          user_id: userId,
          brand: data.vehicle.brand,
          model: data.vehicle.model,
          color: data.vehicle.color,
          plate: data.vehicle.plate.toUpperCase(),
        },
        { onConflict: 'user_id' },
      );
    } else if (data.role === 'pasajero') {
      // Si es pasajero, eliminar vehículo existente si lo tenía
      await supabase.from('vehicles').delete().eq('user_id', userId);
    }

    return {
      success: true,
      message: 'Perfil actualizado exitosamente en la base de datos.',
    };
  }
}

