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
    const [{ error: routesError }, { error: profileError }, { error: remindersError }, { error: bookingsError }] = await Promise.all([
      client.from('routes').select('id,driver_finished_at,meeting_point').limit(1),
      client.from('profiles').select('phone').limit(1),
      client.from('trip_attendance').select('route_id').limit(1),
      client.from('bookings').select('id,responded_at').limit(1),
    ]);
    if (routesError || profileError || remindersError || bookingsError) {
      throw new ServiceUnavailableException('Base de datos no disponible o migraciones pendientes.');
    }
    return { status: 'ok', database: 'connected' };
  }
}
