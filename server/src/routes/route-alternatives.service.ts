import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import { throwDatabaseError } from '../common/database-error.js';
import type { RouteRow } from './routes.service.js';

/**
 * SCRUM-136: Servicio para sugerir rutas alternativas cuando se cancela un viaje.
 * Busca rutas activas con origen/destino similares en una ventana de ±2 horas.
 */

export interface AlternativeRoute {
  id: string;
  driverName: string;
  driverPhotoUrl: string | null;
  origin: string;
  destination: string;
  meetingPoint: string;
  date: string;
  time: string;
  availableSeats: number;
  price: number;
}

@Injectable()
export class RouteAlternativesService {
  private readonly logger = new Logger(RouteAlternativesService.name);

  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

  /**
   * Busca hasta 5 rutas activas similares a la ruta cancelada.
   * Filtra por origen/destino con ILIKE y una ventana de ±2 horas alrededor de la hora original.
   */
  async findAlternatives(routeId: string): Promise<AlternativeRoute[]> {
    const admin = this.supabase.getClient();

    // Obtener la ruta cancelada para conocer sus datos
    const { data: cancelledRoute, error: routeError } = await admin
      .from('route_catalog')
      .select('id,origin,destination,departure_at,driver_id')
      .eq('id', routeId)
      .maybeSingle();

    if (routeError) throwDatabaseError(routeError);
    if (!cancelledRoute) return [];

    const departure = new Date(cancelledRoute.departure_at as string);
    const windowStart = new Date(departure.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(departure.getTime() + 2 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    // Escape SQL LIKE metacharacters
    const sanitize = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;

    const { data: alternatives, error } = await admin
      .from('route_catalog')
      .select('*')
      .eq('status', 'published')
      .gt('available_seats', 0)
      .gt('departure_at', now)
      .neq('id', routeId)
      .neq('driver_id', cancelledRoute.driver_id)
      .gte('departure_at', windowStart)
      .lte('departure_at', windowEnd)
      .ilike('origin', sanitize(cancelledRoute.origin as string))
      .ilike('destination', sanitize(cancelledRoute.destination as string))
      .order('departure_at')
      .limit(5);

    if (error) {
      this.logger.warn(`No se pudieron obtener rutas alternativas para ${routeId}: ${error.message}`);
      return [];
    }

    if (!alternatives?.length) return [];

    // Enriquecer con foto del conductor
    const driverIds = [...new Set((alternatives as RouteRow[]).map((r) => r.driver_id))];
    const { data: profiles } = await admin.from('profiles')
      .select('id,photo_url').in('id', driverIds);
    const photoUrls = new Map((profiles ?? []).map((p: { id: string; photo_url: string | null }) => [p.id, p.photo_url]));

    return (alternatives as RouteRow[]).map((row) => {
      const local = new Date(new Date(row.departure_at).getTime() - 5 * 60 * 60 * 1000).toISOString();
      return {
        id: row.id,
        driverName: row.driver_name,
        driverPhotoUrl: photoUrls.get(row.driver_id) ?? null,
        origin: row.origin,
        destination: row.destination,
        meetingPoint: row.meeting_point,
        date: local.slice(0, 10),
        time: local.slice(11, 16),
        availableSeats: row.available_seats,
        price: Number(row.price),
      };
    });
  }
}
