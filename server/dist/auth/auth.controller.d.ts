import { AuthService, AuthResponse } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';
import { ResendVerificationDto } from './dto/resend-verification.dto.js';
import { ChangeUnverifiedEmailDto } from './dto/change-email.dto.js';
import { RequestEmailChangeDto } from './dto/request-email-change.dto.js';
import { ConfirmEmailChangeDto } from './dto/confirm-email-change.dto.js';
import { CancelEmailChangeDto } from './dto/cancel-email-change.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
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
        isActive: boolean;
        skipVehicle?: boolean;
        vehicle?: {
            brand: string;
            model: string;
            color: string;
            plate: string;
        };
    }>;
    verifyEmailByLink(token: string): Promise<{
        url: string;
        statusCode: number;
    }>;
    verifyEmailApi(verifyEmailDto: VerifyEmailDto): Promise<{
        success: boolean;
        message: string;
    }>;
    resendVerification(resendDto: ResendVerificationDto): Promise<{
        message: string;
    }>;
    changeUnverifiedEmail(changeEmailDto: ChangeUnverifiedEmailDto): Promise<{
        message: string;
    }>;
    requestEmailChange(dto: RequestEmailChangeDto): Promise<{
        success: boolean;
        message: string;
        pendingEmail: string;
    }>;
    confirmEmailChange(dto: ConfirmEmailChangeDto): Promise<{
        success: boolean;
        message: string;
        newEmail: string;
    }>;
    cancelEmailChange(dto: CancelEmailChangeDto): Promise<{
        success: boolean;
        message: string;
    }>;
    resendEmailChangeCode(dto: CancelEmailChangeDto): Promise<{
        success: boolean;
        message: string;
        pendingEmail: string;
    }>;
    updateProfile(dto: UpdateProfileDto): Promise<{
        success: boolean;
        message: string;
    }>;
    logout(): Promise<{
        message: string;
    }>;
}
