import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SupabaseService } from './supabase/supabase.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get()
  live() {
    return { status: 'ok', service: 'asiento-libre-api' };
  }

  @Get('ready')
  async ready() {
    const { error } = await this.supabase.getClient().from('routes').select('id,driver_finished_at').limit(1);
    if (error) throw new ServiceUnavailableException('Base de datos no disponible o migración de rutas pendiente.');
    return { status: 'ok', database: 'connected' };
  }
}
