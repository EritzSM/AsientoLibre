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
export declare class AuthService {
    private readonly supabaseService;
    private readonly logger;
    constructor(supabaseService: SupabaseService);
    register(registerDto: RegisterDto): Promise<AuthResponse>;
    login(loginDto: LoginDto): Promise<AuthResponse>;
    getMe(token: string): Promise<AuthResponse['user']>;
}
