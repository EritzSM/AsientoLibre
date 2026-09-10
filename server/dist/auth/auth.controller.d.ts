import { AuthService, AuthResponse } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    register(registerDto: RegisterDto): Promise<AuthResponse>;
    login(loginDto: LoginDto): Promise<AuthResponse>;
    getMe(authHeader?: string): Promise<{
        id: string;
        firstName: string;
        lastName: string;
        nationalId?: string;
        email: string;
        role: "pasajero" | "conductor";
        skipVehicle?: boolean;
        vehicle?: {
            brand: string;
            model: string;
            color: string;
            plate: string;
        };
    }>;
    logout(): Promise<{
        message: string;
    }>;
}
