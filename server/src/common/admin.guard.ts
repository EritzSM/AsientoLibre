import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseService } from '../supabase/supabase.service.js';

export interface AdminRequest extends Request {
  actorId: string;
  accessToken: string;
}

/**
 * Guard que protege rutas exclusivas del panel de administración.
 * Verifica que el token Bearer pertenezca a un usuario con role = 'admin'.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const match = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? '');
    if (!match) throw new UnauthorizedException('Debes iniciar sesión para continuar.');

    const { data, error } = await this.supabase.getClient().auth.getUser(match[1]);
    if (error || !data.user) throw new UnauthorizedException('La sesión expiró o no es válida.');

    const { data: profile, error: profileError } = await this.supabase
      .getClient()
      .from('profiles')
      .select('role, is_active')
      .eq('id', data.user.id)
      .maybeSingle();

    if (profileError || !profile?.is_active) {
      throw new UnauthorizedException('Cuenta no verificada o inactiva.');
    }

    if (profile.role !== 'admin') {
      throw new ForbiddenException('Acceso denegado. Se requieren permisos de administrador.');
    }

    request.actorId = data.user.id;
    request.accessToken = match[1];
    return true;
  }
}
