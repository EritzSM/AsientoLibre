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
import { Injectable, BadRequestException, UnauthorizedException, Logger, } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
let AuthService = AuthService_1 = class AuthService {
    supabaseService;
    logger = new Logger(AuthService_1.name);
    constructor(supabaseService) {
        this.supabaseService = supabaseService;
    }
    async register(registerDto) {
        if (!this.supabaseService.isConfigured()) {
            throw new BadRequestException('Supabase no está configurado en el servidor. Por favor configura SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_ANON_KEY) en server/.env');
        }
        const supabase = this.supabaseService.getClient();
        let userId = null;
        let sessionToken = null;
        let refreshToken = null;
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
                const { data: loginData } = await supabase.auth.signInWithPassword({
                    email: registerDto.email,
                    password: registerDto.password,
                });
                if (loginData?.session) {
                    sessionToken = loginData.session.access_token;
                    refreshToken = loginData.session.refresh_token;
                }
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
        const { error: profileError } = await supabase.from('profiles').upsert({
            id: userId,
            first_name: registerDto.firstName,
            last_name: registerDto.lastName,
            national_id: registerDto.nationalId,
            role: registerDto.role,
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
};
AuthService = AuthService_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [SupabaseService])
], AuthService);
export { AuthService };
//# sourceMappingURL=auth.service.js.map