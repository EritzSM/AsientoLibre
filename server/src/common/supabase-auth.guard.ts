import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseService } from '../supabase/supabase.service.js';

export interface AuthenticatedRequest extends Request {
  actorId: string;
}

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? '');
    if (!match) throw new UnauthorizedException('Debes iniciar sesión para continuar.');

    const { data, error } = await this.supabase.getClient().auth.getUser(match[1]);
    if (error || !data.user) throw new UnauthorizedException('La sesión expiró o no es válida.');
    const { data: profile, error: profileError } = await this.supabase.getClient().from('profiles')
      .select('is_active').eq('id', data.user.id).maybeSingle();
    if (profileError || !profile?.is_active) {
      throw new UnauthorizedException('Debes verificar tu correo antes de continuar.');
    }
    request.actorId = data.user.id;
    return true;
  }
}
