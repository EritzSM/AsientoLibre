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
    const client = this.supabase.getClient();
    const [{ error: routesError }, { error: profileError }] = await Promise.all([
      client.from('routes').select('id').limit(1),
      client.from('profiles').select('phone').limit(1),
    ]);
    if (routesError || profileError) {
      throw new ServiceUnavailableException('Base de datos no disponible o migraciones pendientes.');
    }
    return { status: 'ok', database: 'connected' };
  }
}
