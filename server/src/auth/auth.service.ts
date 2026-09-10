import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import { EmailService } from '../email/email.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

const hashCode = (code: string) => createHash('sha256').update(code).digest('hex');
const sameDigest = (left: string, right: string) => {
  const first = Buffer.from(left, 'hex');
  const second = Buffer.from(right, 'hex');
  return first.length === second.length && timingSafeEqual(first, second);
};

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
      id?: string;
      brand: string;
      model: string;
      color: string;
      plate: string;
      capacity: number | null;
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

  async register(registerDto: RegisterDto): Promise<AuthResponse> {
    const admin = this.supabaseService.getClient();
    if (registerDto.role === 'conductor' && !registerDto.skipVehicle && !registerDto.vehicle) {
      throw new BadRequestException('Registra tu vehículo o selecciona agregarlo después.');
    }
    const activationToken = randomUUID();
    const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await admin.auth.admin.createUser({
      email: registerDto.email,
      password: registerDto.password,
      email_confirm: true,
      user_metadata: { firstName: registerDto.firstName, lastName: registerDto.lastName },
    });
    if (error || !data.user) {
      if (error?.code === 'email_exists' || error?.code === 'user_already_exists') {
        throw new BadRequestException('El correo electrónico ya se encuentra registrado.');
      }
      if (error?.status && error.status < 500) throw new BadRequestException('No se pudo registrar la cuenta. Verifica el correo y la contraseña.');
      throw new ServiceUnavailableException('No se pudo conectar con el servicio de autenticación.');
    }
    const userId = data.user.id;
    try {
      const { error: profileError } = await admin.from('profiles').insert({
        id: userId,
        first_name: registerDto.firstName,
        last_name: registerDto.lastName,
        national_id: registerDto.nationalId,
        role: registerDto.role,
        is_active: false,
        activation_token: activationToken,
        token_expires_at: tokenExpiresAt,
      });
      if (profileError) throw profileError;
      if (registerDto.role === 'conductor' && !registerDto.skipVehicle && registerDto.vehicle) {
        const { error: vehicleError } = await admin.from('vehicles').insert({
          user_id: userId,
          brand: registerDto.vehicle.brand,
          model: registerDto.vehicle.model,
          color: registerDto.vehicle.color,
          plate: registerDto.vehicle.plate.toUpperCase(),
          capacity: registerDto.vehicle.capacity,
        });
        if (vehicleError) throw vehicleError;
      }
      await this.emailService.sendActivationEmail(registerDto.email, registerDto.firstName, activationToken);
    } catch {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(userId);
      if (cleanupError) this.logger.error(`No se pudo revertir el registro incompleto ${userId}.`);
      throw new ServiceUnavailableException('No se pudo completar el registro. Verifica la configuración e inténtalo nuevamente.');
    }

    return {
      message: 'Cuenta creada. Revisa tu correo para activarla.',
      access_token: null,
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
        vehicle: registerDto.vehicle ? { ...registerDto.vehicle, plate: registerDto.vehicle.plate.toUpperCase() } : undefined,
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
  async changeUnverifiedEmail(currentEmail: string, newEmail: string, password: string): Promise<{ message: string }> {
    if (currentEmail.toLowerCase() === newEmail.toLowerCase()) {
      throw new BadRequestException('El nuevo correo debe ser diferente al actual.');
    }
    const { data: authData, error: authError } = await this.supabaseService.createAuthClient().auth
      .signInWithPassword({ email: currentEmail, password });
    if (authError || !authData.user) {
      throw new UnauthorizedException('El correo actual o la contraseña no son correctos.');
    }
    const userId = authData.user.id;
    const admin = this.supabaseService.getClient();
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('is_active, first_name')
      .eq('id', userId)
      .maybeSingle();
    if (profileError || !profile) throw new NotFoundException('No se encontró el perfil de la cuenta.');
    if (profile.is_active) {
      throw new BadRequestException('Esta cuenta ya está verificada. No es posible cambiar el correo de esta manera.');
    }
    const { error: authUpdateError } = await admin.auth.admin.updateUserById(userId, {
      email: newEmail,
      email_confirm: true,
    });
    if (authUpdateError) {
      throw new BadRequestException('El nuevo correo no está disponible o no pudo actualizarse.');
    }
    const newToken = randomUUID();
    const newExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { error: profileUpdateError } = await admin
      .from('profiles')
      .update({
        activation_token: newToken,
        token_expires_at: newExpiry,
      })
      .eq('id', userId);
    if (profileUpdateError) {
      throw new ServiceUnavailableException('El correo cambió, pero no se pudo generar el nuevo enlace de activación.');
    }
    await this.emailService.sendActivationEmail(newEmail, profile.first_name || 'Usuario', newToken);
    return {
      message: `Correo actualizado a ${newEmail}. Hemos enviado un nuevo enlace de verificación a tu nueva dirección.`,
    };
  }

  /**
   * Inicia sesión con correo y contraseña
   */
  async login(loginDto: LoginDto): Promise<AuthResponse> {
    const admin = this.supabaseService.getClient();
    const { data: authData, error: authError } = await this.supabaseService.createAuthClient().auth.signInWithPassword({
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
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    // Obtener vehículo si existe
    const { data: vehicle, error: vehicleError } = await admin
      .from('vehicles')
      .select('id, brand, model, color, plate, capacity')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError || vehicleError || !profile) {
      throw new ServiceUnavailableException('No se pudo consultar el perfil del usuario.');
    }

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
              id: vehicle.id,
              model: vehicle.model,
              color: vehicle.color,
              plate: vehicle.plate,
              capacity: vehicle.capacity,
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

    const admin = this.supabaseService.getClient();
    const { data, error } = await admin.auth.getUser(token);

    if (error || !data.user) {
      throw new UnauthorizedException('Token no válido o sesión expirada');
    }

    const user = data.user;

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    const { data: vehicle, error: vehicleError } = await admin
      .from('vehicles')
      .select('id, brand, model, color, plate, capacity')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError || vehicleError || !profile) {
      throw new ServiceUnavailableException('No se pudo consultar el perfil del usuario.');
    }

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
            id: vehicle.id,
            brand: vehicle.brand,
            model: vehicle.model,
            color: vehicle.color,
            plate: vehicle.plate,
            capacity: vehicle.capacity,
          }
        : undefined,
    };
  }

  /**
   * Solicita el cambio de correo electrónico enviando un código de 6 dígitos al nuevo correo.
   * Valida que el nuevo correo no esté ya en uso en otra cuenta.
   */
  async requestEmailChange(
    actorId: string,
    newEmail: string,
  ): Promise<{ success: boolean; message: string; pendingEmail: string }> {
    const admin = this.supabaseService.getClient();
    const { data: userResult, error: userError } = await admin.auth.admin.getUserById(actorId);
    const currentEmail = userResult.user?.email?.toLowerCase();
    const targetEmail = newEmail.trim().toLowerCase();
    if (userError || !currentEmail) throw new NotFoundException('No se encontró la cuenta autenticada.');
    if (currentEmail === targetEmail) throw new BadRequestException('El nuevo correo debe ser diferente al actual.');

    const code = randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { data: profile, error } = await admin.from('profiles')
      .update({ pending_email: targetEmail, email_change_code: hashCode(code), email_change_expires_at: expiresAt })
      .eq('id', actorId).select('first_name').single();
    if (error) throw new ServiceUnavailableException('No se pudo registrar la solicitud de cambio de correo.');
    await this.emailService.sendEmailChangeCode(targetEmail, profile.first_name || 'Usuario', code);
    return { success: true, message: `Enviamos un código de 6 dígitos a ${targetEmail}.`, pendingEmail: targetEmail };
  }

  async confirmEmailChange(
    actorId: string,
    code: string,
  ): Promise<{ success: boolean; message: string; newEmail: string }> {
    const admin = this.supabaseService.getClient();
    const { data: profile, error } = await admin.from('profiles')
      .select('pending_email,email_change_code,email_change_expires_at')
      .eq('id', actorId).maybeSingle();
    if (error || !profile) throw new NotFoundException('Perfil de usuario no encontrado.');
    if (!profile.pending_email || !profile.email_change_code || !profile.email_change_expires_at) {
      throw new BadRequestException('No existe una solicitud de cambio de correo pendiente.');
    }
    if (new Date(profile.email_change_expires_at).getTime() <= Date.now()) {
      throw new BadRequestException('El código de verificación expiró. Solicita uno nuevo.');
    }
    if (!/^\d{6}$/.test(code) || !sameDigest(profile.email_change_code, hashCode(code))) {
      throw new BadRequestException('El código de verificación es incorrecto.');
    }

    const targetEmail = profile.pending_email;
    const { error: authError } = await admin.auth.admin.updateUserById(actorId, { email: targetEmail, email_confirm: true });
    if (authError) throw new BadRequestException('El nuevo correo no está disponible o no pudo actualizarse.');
    const { error: clearError } = await admin.from('profiles').update({
      pending_email: null, email_change_code: null, email_change_expires_at: null,
    }).eq('id', actorId);
    if (clearError) throw new ServiceUnavailableException('El correo cambió, pero no se pudo cerrar la solicitud pendiente.');
    return { success: true, message: 'Tu correo electrónico fue actualizado.', newEmail: targetEmail };
  }

  async cancelEmailChange(actorId: string): Promise<{ success: boolean; message: string }> {
    const { error } = await this.supabaseService.getClient().from('profiles').update({
      pending_email: null, email_change_code: null, email_change_expires_at: null,
    }).eq('id', actorId);
    if (error) throw new ServiceUnavailableException('No se pudo cancelar la solicitud de cambio de correo.');
    return { success: true, message: 'La solicitud de cambio de correo fue cancelada.' };
  }

  async resendEmailChangeCode(
    actorId: string,
  ): Promise<{ success: boolean; message: string; pendingEmail: string }> {
    const admin = this.supabaseService.getClient();
    const { data: profile, error: profileError } = await admin.from('profiles')
      .select('pending_email,first_name').eq('id', actorId).maybeSingle();
    if (profileError || !profile?.pending_email) {
      throw new BadRequestException('No hay una solicitud de cambio de correo pendiente.');
    }
    const code = randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { error } = await admin.from('profiles').update({
      email_change_code: hashCode(code), email_change_expires_at: expiresAt,
    }).eq('id', actorId);
    if (error) throw new ServiceUnavailableException('No se pudo generar un nuevo código.');
    await this.emailService.sendEmailChangeCode(profile.pending_email, profile.first_name || 'Usuario', code);
    return { success: true, message: `Enviamos un nuevo código a ${profile.pending_email}.`, pendingEmail: profile.pending_email };
  }

  async updateProfile(
    actorId: string,
    data: { firstName: string; lastName: string; nationalId: string },
  ): Promise<{ success: boolean; message: string }> {
    const { error } = await this.supabaseService.getClient().from('profiles').update({
      first_name: data.firstName.trim(),
      last_name: data.lastName.trim(),
      national_id: data.nationalId.trim(),
    }).eq('id', actorId);
    if (error) throw new BadRequestException('No se pudieron actualizar los datos del perfil.');
    return { success: true, message: 'Perfil actualizado exitosamente.' };
  }

}
