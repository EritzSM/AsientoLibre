var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Controller, Post, Get, Body, Headers, Query, HttpCode, HttpStatus, UnauthorizedException, Redirect, } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';
import { ResendVerificationDto } from './dto/resend-verification.dto.js';
import { ChangeUnverifiedEmailDto } from './dto/change-email.dto.js';
import { RequestEmailChangeDto } from './dto/request-email-change.dto.js';
import { ConfirmEmailChangeDto } from './dto/confirm-email-change.dto.js';
import { CancelEmailChangeDto } from './dto/cancel-email-change.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
let AuthController = class AuthController {
    authService;
    constructor(authService) {
        this.authService = authService;
    }
    async register(registerDto) {
        return this.authService.register(registerDto);
    }
    async login(loginDto) {
        return this.authService.login(loginDto);
    }
    async getMe(authHeader) {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new UnauthorizedException('Encabezado Authorization requerido con formato Bearer <token>');
        }
        const token = authHeader.replace('Bearer ', '').trim();
        return this.authService.getMe(token);
    }
    async verifyEmailByLink(token) {
        const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
        if (!token) {
            return { url: `${frontendUrl}/login.html?error=invalid_token`, statusCode: 302 };
        }
        const result = await this.authService.verifyEmail(token);
        return { url: result.redirectUrl, statusCode: 302 };
    }
    async verifyEmailApi(verifyEmailDto) {
        const result = await this.authService.verifyEmail(verifyEmailDto.token);
        return {
            success: result.success,
            message: result.success
                ? '¡Correo verificado exitosamente! Ya puedes iniciar sesión.'
                : 'El enlace de verificación es inválido o ha expirado.',
        };
    }
    async resendVerification(resendDto) {
        return this.authService.resendVerification(resendDto.email);
    }
    async changeUnverifiedEmail(changeEmailDto) {
        return this.authService.changeUnverifiedEmail(changeEmailDto.currentEmail, changeEmailDto.newEmail);
    }
    async requestEmailChange(dto) {
        return this.authService.requestEmailChange(dto.currentEmail, dto.newEmail);
    }
    async confirmEmailChange(dto) {
        return this.authService.confirmEmailChange(dto.currentEmail, dto.code);
    }
    async cancelEmailChange(dto) {
        return this.authService.cancelEmailChange(dto.currentEmail);
    }
    async resendEmailChangeCode(dto) {
        return this.authService.resendEmailChangeCode(dto.currentEmail);
    }
    async updateProfile(dto) {
        return this.authService.updateProfile(dto.userId, {
            firstName: dto.firstName,
            lastName: dto.lastName,
            nationalId: dto.nationalId || '',
            role: dto.role,
            vehicle: dto.vehicle,
        });
    }
    async logout() {
        return { message: 'Sesión cerrada exitosamente' };
    }
};
__decorate([
    Post('register'),
    HttpCode(HttpStatus.CREATED),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [RegisterDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "register", null);
__decorate([
    Post('login'),
    HttpCode(HttpStatus.OK),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [LoginDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
__decorate([
    Get('me'),
    __param(0, Headers('authorization')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "getMe", null);
__decorate([
    Get('verify-email'),
    Redirect(),
    __param(0, Query('token')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "verifyEmailByLink", null);
__decorate([
    Post('verify-email'),
    HttpCode(HttpStatus.OK),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [VerifyEmailDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "verifyEmailApi", null);
__decorate([
    Post('resend-verification'),
    HttpCode(HttpStatus.OK),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ResendVerificationDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "resendVerification", null);
__decorate([
    Post('change-unverified-email'),
    HttpCode(HttpStatus.OK),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ChangeUnverifiedEmailDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "changeUnverifiedEmail", null);
__decorate([
    Post('request-email-change'),
    HttpCode(HttpStatus.OK),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [RequestEmailChangeDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "requestEmailChange", null);
__decorate([
    Post('confirm-email-change'),
    HttpCode(HttpStatus.OK),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ConfirmEmailChangeDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "confirmEmailChange", null);
__decorate([
    Post('cancel-email-change'),
    HttpCode(HttpStatus.OK),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CancelEmailChangeDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "cancelEmailChange", null);
__decorate([
    Post('resend-email-change-code'),
    HttpCode(HttpStatus.OK),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CancelEmailChangeDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "resendEmailChangeCode", null);
__decorate([
    Post('update-profile'),
    HttpCode(HttpStatus.OK),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [UpdateProfileDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "updateProfile", null);
__decorate([
    Post('logout'),
    HttpCode(HttpStatus.OK),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "logout", null);
AuthController = __decorate([
    Controller('auth'),
    __metadata("design:paramtypes", [AuthService])
], AuthController);
export { AuthController };
//# sourceMappingURL=auth.controller.js.map