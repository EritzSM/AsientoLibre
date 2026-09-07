var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AuthService_1;
import { Injectable, BadRequestException, UnauthorizedException, NotFoundException, Logger, } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import { EmailService } from '../email/email.service.js';
import { randomUUID } from 'crypto';
let AuthService = AuthService_1 = class AuthService {
    supabaseService;
    emailService;
    logger = new Logger(AuthService_1.name);
    constructor(supabaseService, emailService) {
        this.supabaseService = supabaseService;
        this.emailService = emailService;
    }
    async register(registerDto) {
        if (!this.supabaseService.isConfigured()) {
            throw new BadRequestException('Supabase no está configurado en el servidor. Por favor configura SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_ANON_KEY) en server/.env');
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(registerDto.email)) {
            throw new BadRequestException('El correo electrónico no tiene un formato válido');
        }
        const supabase = this.supabaseService.getClient();
        let userId = null;
        try {
            const { data: existingUsers } = await supabase.auth.admin.listUsers();
            if (existingUsers?.users?.some((u) => u.email === registerDto.email)) {
                throw new BadRequestException('El correo electrónico ya se encuentra registrado');
            }
        }
        catch (err) {
            if (err instanceof BadRequestException)
                throw err;
            this.logger.debug('No se pudo verificar correo existente vía admin, continuando...');
        }
        const activationToken = randomUUID();
        const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
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
            }
            else if (adminError) {
                this.logger.debug(`Fallo createUser admin (${adminError.message}), intentando signUp público...`);
            }
        }
        catch {
            this.logger.debug('Admin API no disponible, usando signUp público...');
        }
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
                if (signUpError.message.toLowerCase().includes('already registered') ||
                    signUpError.message.toLowerCase().includes('duplicate')) {
                    throw new BadRequestException('El correo electrónico ya se encuentra registrado');
                }
                throw new BadRequestException(`Error al registrar el usuario: ${signUpError.message}`);
            }
            if (!signUpData.user) {
                throw new BadRequestException('No se pudo crear la cuenta de usuario');
            }
            userId = signUpData.user.id;
        }
        const { error: profileError } = await supabase.from('profiles').upsert({
            id: userId,
            first_name: registerDto.firstName,
            last_name: registerDto.lastName,
            national_id: registerDto.nationalId,
            role: registerDto.role,
            is_active: false,
            activation_token: activationToken,
            token_expires_at: tokenExpiresAt,
        }, { onConflict: 'id' });
        if (profileError) {
            this.logger.error(`Error al crear perfil en public.profiles: ${profileError.message}`);
        }
        let vehicleData = undefined;
        if (registerDto.role === 'conductor' && !registerDto.skipVehicle && registerDto.vehicle) {
            const { error: vehicleError } = await supabase.from('vehicles').upsert({
                user_id: userId,
                brand: registerDto.vehicle.brand,
                model: registerDto.vehicle.model,
                color: registerDto.vehicle.color,
                plate: registerDto.vehicle.plate.toUpperCase(),
            }, { onConflict: 'user_id' });
            if (vehicleError) {
                this.logger.error(`Error al registrar vehículo en public.vehicles: ${vehicleError.message}`);
            }
            else {
                vehicleData = {
                    brand: registerDto.vehicle.brand,
                    model: registerDto.vehicle.model,
                    color: registerDto.vehicle.color,
                    plate: registerDto.vehicle.plate.toUpperCase(),
                };
            }
        }
        await this.emailService.sendActivationEmail(registerDto.email, registerDto.firstName, activationToken);
        return {
            message: 'Cuenta creada exitosamente. Hemos enviado un correo de verificación a tu dirección de email. Por favor revisa tu bandeja de entrada y spam.',
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
                vehicle: vehicleData ?? registerDto.vehicle,
            },
        };
    }
    async verifyEmail(token) {
        if (!this.supabaseService.isConfigured()) {
            throw new BadRequestException('Supabase no está configurado en el servidor');
        }
        const supabase = this.supabaseService.getClient();
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('id, is_active, token_expires_at, first_name')
            .eq('activation_token', token)
            .maybeSingle();
        if (error) {
            this.logger.error(`Error al buscar token de activación: ${error.message}`);
        }
        const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
        if (!profile) {
            return {
                success: false,
                redirectUrl: `${frontendUrl}/login.html?error=invalid_token`,
            };
        }
        if (profile.is_active) {
            return {
                success: true,
                redirectUrl: `${frontendUrl}/login.html?activated=true`,
            };
        }
        const now = new Date();
        const expiresAt = profile.token_expires_at ? new Date(profile.token_expires_at) : null;
        if (!expiresAt || expiresAt < now) {
            return {
                success: false,
                redirectUrl: `${frontendUrl}/login.html?error=expired_token`,
            };
        }
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
    async resendVerification(email) {
        if (!this.supabaseService.isConfigured()) {
            throw new BadRequestException('Supabase no está configurado en el servidor');
        }
        const supabase = this.supabaseService.getClient();
        let userId = null;
        let firstName = 'Usuario';
        try {
            const { data: users } = await supabase.auth.admin.listUsers();
            const found = users?.users?.find((u) => u.email === email);
            if (found) {
                userId = found.id;
                firstName = found.user_metadata?.firstName || 'Usuario';
            }
        }
        catch {
            this.logger.debug('No se pudo buscar usuario vía admin API');
        }
        if (!userId) {
            return {
                message: 'Si el correo está registrado y pendiente de verificación, recibirás un nuevo enlace de activación.',
            };
        }
        const { data: profile } = await supabase
            .from('profiles')
            .select('is_active, first_name')
            .eq('id', userId)
            .maybeSingle();
        if (!profile) {
            return {
                message: 'Si el correo está registrado y pendiente de verificación, recibirás un nuevo enlace de activación.',
            };
        }
        if (profile.is_active) {
            throw new BadRequestException('Este correo ya ha sido verificado. Puedes iniciar sesión normalmente.');
        }
        firstName = profile.first_name || firstName;
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
            message: 'Correo de verificación reenviado exitosamente. Revisa tu bandeja de entrada y también la carpeta de spam.',
        };
    }
    async changeUnverifiedEmail(currentEmail, newEmail) {
        if (!this.supabaseService.isConfigured()) {
            throw new BadRequestException('Supabase no está configurado en el servidor');
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(newEmail)) {
            throw new BadRequestException('El nuevo correo electrónico no tiene un formato válido');
        }
        if (currentEmail.toLowerCase() === newEmail.toLowerCase()) {
            throw new BadRequestException('El nuevo correo debe ser diferente al actual');
        }
        const supabase = this.supabaseService.getClient();
        let userId = null;
        try {
            const { data: users } = await supabase.auth.admin.listUsers();
            const found = users?.users?.find((u) => u.email === currentEmail);
            if (found)
                userId = found.id;
        }
        catch {
            this.logger.debug('No se pudo verificar correo vía admin API');
        }
        if (!userId) {
            throw new NotFoundException('No se encontró una cuenta con ese correo electrónico');
        }
        const { data: profile } = await supabase
            .from('profiles')
            .select('is_active, first_name')
            .eq('id', userId)
            .maybeSingle();
        if (profile?.is_active) {
            throw new BadRequestException('Esta cuenta ya está verificada. No es posible cambiar el correo de esta manera.');
        }
        try {
            const { data: users } = await supabase.auth.admin.listUsers();
            if (users?.users?.some((u) => u.email === newEmail)) {
                throw new BadRequestException('El nuevo correo electrónico ya está registrado en otra cuenta');
            }
        }
        catch (err) {
            if (err instanceof BadRequestException)
                throw err;
        }
        const { error: authUpdateError } = await supabase.auth.admin.updateUserById(userId, {
            email: newEmail,
        });
        if (authUpdateError) {
            this.logger.error(`Error al actualizar correo en auth: ${authUpdateError.message}`);
            throw new BadRequestException('No se pudo actualizar el correo. Por favor intenta nuevamente.');
        }
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
    async login(loginDto) {
        if (!this.supabaseService.isConfigured()) {
            throw new BadRequestException('Supabase no está configurado en el servidor. Por favor configura SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_ANON_KEY) en server/.env');
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
        const firstName = profile?.first_name ||
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
    async getMe(token) {
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
    async requestEmailChange(currentEmail, newEmail) {
        if (!this.supabaseService.isConfigured()) {
            throw new BadRequestException('Supabase no está configurado en el servidor');
        }
        const curr = currentEmail.trim().toLowerCase();
        const next = newEmail.trim().toLowerCase();
        if (curr === next) {
            throw new BadRequestException('El nuevo correo electrónico es idéntico al actual.');
        }
        const supabase = this.supabaseService.getClient();
        const { data: listData, error: listError } = await supabase.auth.admin.listUsers();
        if (listError) {
            this.logger.error(`Error al listar usuarios para validación de correo: ${listError.message}`);
        }
        const users = listData?.users || [];
        const existingTarget = users.find((u) => u.email?.toLowerCase() === next);
        if (existingTarget) {
            throw new BadRequestException('El correo electrónico ingresado ya se encuentra registrado por otro usuario.');
        }
        const currentUser = users.find((u) => u.email?.toLowerCase() === curr);
        if (!currentUser) {
            throw new NotFoundException('No se encontró el usuario actual en el sistema.');
        }
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
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
        const firstName = currentUser.user_metadata?.firstName || 'Usuario';
        await this.emailService.sendEmailChangeCode(next, firstName, code);
        this.logger.log(`Código de cambio de correo enviado a ${next} para el usuario ${currentUser.id}`);
        return {
            success: true,
            message: `Hemos enviado un código de 6 dígitos a ${next}. Por favor ingrésalo para confirmar el cambio.`,
            pendingEmail: next,
        };
    }
    async confirmEmailChange(currentEmail, code) {
        if (!this.supabaseService.isConfigured()) {
            throw new BadRequestException('Supabase no está configurado en el servidor');
        }
        const curr = currentEmail.trim().toLowerCase();
        const cleanCode = code.trim();
        const supabase = this.supabaseService.getClient();
        const { data: listData } = await supabase.auth.admin.listUsers();
        const users = listData?.users || [];
        const currentUser = users.find((u) => u.email?.toLowerCase() === curr);
        if (!currentUser) {
            throw new NotFoundException('No se encontró el usuario actual en el sistema.');
        }
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
        if (profile.email_change_code !== cleanCode) {
            throw new BadRequestException('El código de verificación es incorrecto.');
        }
        if (!profile.email_change_expires_at || new Date(profile.email_change_expires_at) < new Date()) {
            throw new BadRequestException('El código de verificación ha expirado. Por favor solicita un nuevo código.');
        }
        const targetEmail = profile.pending_email.trim().toLowerCase();
        const alreadyTaken = users.some((u) => u.id !== currentUser.id && u.email?.toLowerCase() === targetEmail);
        if (alreadyTaken) {
            throw new BadRequestException('El nuevo correo electrónico ya fue registrado por otra cuenta.');
        }
        const { error: updateAuthError } = await supabase.auth.admin.updateUserById(currentUser.id, {
            email: targetEmail,
            email_confirm: true,
        });
        if (updateAuthError) {
            this.logger.error(`Error al actualizar email en Supabase Auth: ${updateAuthError.message}`);
            throw new BadRequestException(`Error al actualizar el correo en autenticación: ${updateAuthError.message}`);
        }
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
    async cancelEmailChange(currentEmail) {
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
    async resendEmailChangeCode(currentEmail) {
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
    async updateProfile(userId, data) {
        if (!this.supabaseService.isConfigured()) {
            throw new BadRequestException('Supabase no está configurado en el servidor');
        }
        const supabase = this.supabaseService.getClient();
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
        if (data.role === 'conductor' && data.vehicle) {
            await supabase.from('vehicles').upsert({
                user_id: userId,
                brand: data.vehicle.brand,
                model: data.vehicle.model,
                color: data.vehicle.color,
                plate: data.vehicle.plate.toUpperCase(),
            }, { onConflict: 'user_id' });
        }
        else if (data.role === 'pasajero') {
            await supabase.from('vehicles').delete().eq('user_id', userId);
        }
        return {
            success: true,
            message: 'Perfil actualizado exitosamente en la base de datos.',
        };
    }
};
AuthService = AuthService_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [SupabaseService,
        EmailService])
], AuthService);
export { AuthService };
//# sourceMappingURL=auth.service.js.map