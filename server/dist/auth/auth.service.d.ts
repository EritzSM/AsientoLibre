import { SupabaseService } from '../supabase/supabase.service.js';
import { EmailService } from '../email/email.service.js';
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
export declare class AuthService {
    private readonly supabaseService;
    private readonly emailService;
    private readonly logger;
    constructor(supabaseService: SupabaseService, emailService: EmailService);
    register(registerDto: RegisterDto): Promise<AuthResponse>;
    verifyEmail(token: string): Promise<{
        success: boolean;
        redirectUrl: string;
    }>;
    resendVerification(email: string): Promise<{
        message: string;
    }>;
    changeUnverifiedEmail(currentEmail: string, newEmail: string): Promise<{
        message: string;
    }>;
    login(loginDto: LoginDto): Promise<AuthResponse>;
    getMe(token: string): Promise<AuthResponse['user']>;
    requestEmailChange(currentEmail: string, newEmail: string): Promise<{
        success: boolean;
        message: string;
        pendingEmail: string;
    }>;
    confirmEmailChange(currentEmail: string, code: string): Promise<{
        success: boolean;
        message: string;
        newEmail: string;
    }>;
    cancelEmailChange(currentEmail: string): Promise<{
        success: boolean;
        message: string;
    }>;
    resendEmailChangeCode(currentEmail: string): Promise<{
        success: boolean;
        message: string;
        pendingEmail: string;
    }>;
    updateProfile(userId: string, data: {
        firstName: string;
        lastName: string;
        nationalId: string;
        role: 'pasajero' | 'conductor';
        vehicle?: {
            brand: string;
            model: string;
            color: string;
            plate: string;
        };
    }): Promise<{
        success: boolean;
        message: string;
    }>;
}
