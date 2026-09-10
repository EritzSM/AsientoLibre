import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  Query,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Redirect,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthService, AuthResponse } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';
import { ResendVerificationDto } from './dto/resend-verification.dto.js';
import { ChangeUnverifiedEmailDto } from './dto/change-email.dto.js';

import { RequestEmailChangeDto } from './dto/request-email-change.dto.js';
import { ConfirmEmailChangeDto } from './dto/confirm-email-change.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { SupabaseAuthGuard } from '../common/supabase-auth.guard.js';
import type { AuthenticatedRequest } from '../common/supabase-auth.guard.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() registerDto: RegisterDto): Promise<AuthResponse> {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto): Promise<AuthResponse> {
    return this.authService.login(loginDto);
  }

  @Get('me')
  async getMe(@Headers('authorization') authHeader?: string) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Encabezado Authorization requerido con formato Bearer <token>');
    }
    const token = authHeader.replace('Bearer ', '').trim();
    return this.authService.getMe(token);
  }

  /**
   * GET /auth/verify-email?token=...
   * Endpoint que recibe el clic desde el correo de activación y redirige al frontend.
   */
  @Get('verify-email')
  @Redirect()
  async verifyEmailByLink(@Query('token') token: string) {
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

    if (!token) {
      return { url: `${frontendUrl}/login.html?error=invalid_token`, statusCode: 302 };
    }

    const result = await this.authService.verifyEmail(token);
    return { url: result.redirectUrl, statusCode: 302 };
  }

  /**
   * POST /auth/verify-email
   * Endpoint API para verificar token vía JSON (uso desde frontend SPA si se necesita).
   */
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmailApi(@Body() verifyEmailDto: VerifyEmailDto) {
    const result = await this.authService.verifyEmail(verifyEmailDto.token);
    return {
      success: result.success,
      message: result.success
        ? '¡Correo verificado exitosamente! Ya puedes iniciar sesión.'
        : 'El enlace de verificación es inválido o ha expirado.',
    };
  }

  /**
   * POST /auth/resend-verification
   * Reenvía el correo de activación con un nuevo token de 24 horas.
   */
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  async resendVerification(@Body() resendDto: ResendVerificationDto) {
    return this.authService.resendVerification(resendDto.email);
  }

  /**
   * POST /auth/change-unverified-email
   * Permite corregir el correo electrónico antes de verificar la cuenta.
   */
  @Post('change-unverified-email')
  @HttpCode(HttpStatus.OK)
  async changeUnverifiedEmail(@Body() changeEmailDto: ChangeUnverifiedEmailDto) {
    return this.authService.changeUnverifiedEmail(
      changeEmailDto.currentEmail,
      changeEmailDto.newEmail,
      changeEmailDto.password,
    );
  }

  /**
   * POST /auth/request-email-change
   * Solicita cambio de correo en perfil enviando código de 6 dígitos al nuevo correo.
   */
  @Post('request-email-change')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SupabaseAuthGuard)
  async requestEmailChange(@Req() req: AuthenticatedRequest, @Body() dto: RequestEmailChangeDto) {
    return this.authService.requestEmailChange(req.actorId, dto.newEmail);
  }

  /**
   * POST /auth/confirm-email-change
   * Valida el código de 6 dígitos y actualiza el correo en la cuenta.
   */
  @Post('confirm-email-change')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SupabaseAuthGuard)
  async confirmEmailChange(@Req() req: AuthenticatedRequest, @Body() dto: ConfirmEmailChangeDto) {
    return this.authService.confirmEmailChange(req.actorId, dto.code);
  }

  /**
   * POST /auth/cancel-email-change
   * Cancela la solicitud pendiente de cambio de correo.
   */
  @Post('cancel-email-change')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SupabaseAuthGuard)
  async cancelEmailChange(@Req() req: AuthenticatedRequest) {
    return this.authService.cancelEmailChange(req.actorId);
  }

  /**
   * POST /auth/resend-email-change-code
   * Reenvía un nuevo código al nuevo correo pendiente.
   */
  @Post('resend-email-change-code')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SupabaseAuthGuard)
  async resendEmailChangeCode(@Req() req: AuthenticatedRequest) {
    return this.authService.resendEmailChangeCode(req.actorId);
  }

  /**
   * POST /auth/update-profile
   * Actualiza los datos del perfil (nombre, identificación, rol, vehículo).
   */
  @Post('update-profile')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SupabaseAuthGuard)
  async updateProfile(@Req() req: AuthenticatedRequest, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(req.actorId, {
      firstName: dto.firstName,
      lastName: dto.lastName,
      nationalId: dto.nationalId,
    });
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout() {
    return { message: 'Sesión cerrada exitosamente' };
  }
}
