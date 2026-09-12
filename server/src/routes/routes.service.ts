import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import { throwDatabaseError } from '../common/database-error.js';
import type { CreateRouteDto, FindRoutesDto } from './dto/route.dto.js';

export interface RouteRow {
  id: string; driver_id: string; driver_name: string; origin: string; destination: string;
  departure_at: string; seats: number; available_seats: number; price: number; note: string | null;
  status: string; confirmed_passengers: number; created_at: string;
  driver_finished_at: string | null; passenger_finished_at?: string | null;
}

export function presentRoute(row: RouteRow) {
  // Colombia does not observe daylight-saving time. Store UTC, expose local date and time.
  const local = new Date(new Date(row.departure_at).getTime() - 5 * 60 * 60 * 1000).toISOString();
  return {
    id: row.id, driverId: row.driver_id, driverName: row.driver_name,
    origin: row.origin, destination: row.destination, date: local.slice(0, 10), time: local.slice(11, 16),
    seats: row.seats, availableSeats: row.available_seats, price: Number(row.price), note: row.note,
    status: row.status, confirmedPassengers: row.confirmed_passengers, createdAt: row.created_at,
    driverFinishedAt: row.driver_finished_at, passengerFinishedAt: row.passenger_finished_at ?? null,
  };
}

@Injectable()
export class RoutesService {
  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

  async findAvailable(filters: FindRoutesDto) {
    let query = this.supabase.getClient().from('route_catalog').select('*')
      .eq('status', 'published').gt('departure_at', new Date().toISOString()).gt('available_seats', 0);
    // Escape SQL LIKE metacharacters so a location is always treated as literal text.
    const contains = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
    if (filters.origin) query = query.ilike('origin', contains(filters.origin));
    if (filters.destination) query = query.ilike('destination', contains(filters.destination));
    if (filters.date) {
      const from = new Date(`${filters.date}T00:00:00-05:00`);
      query = query.gte('departure_at', from.toISOString()).lt('departure_at', new Date(from.getTime() + 86400000).toISOString());
    }
    const { data, error } = await query.order('departure_at').limit(100);
    if (error) throwDatabaseError(error);
    return (data as RouteRow[]).map(presentRoute);
  }

  async findMine(actorId: string) {
    const { data, error } = await this.supabase.getClient().from('route_catalog').select('*')
      .eq('driver_id', actorId).order('departure_at', { ascending: false }).limit(100);
    if (error) throwDatabaseError(error);
    return (data as RouteRow[]).map(presentRoute);
  }

  async create(actorId: string, dto: CreateRouteDto) {
    if (dto.origin.toLocaleLowerCase('es') === dto.destination.toLocaleLowerCase('es')) {
      throw new BadRequestException('El origen y el destino deben ser diferentes.');
    }
    const departureAt = new Date(`${dto.date}T${dto.time}:00-05:00`);
    if (!Number.isFinite(departureAt.getTime()) || departureAt.getTime() <= Date.now()) {
      throw new BadRequestException('La fecha y hora del viaje deben ser futuras (hora de Colombia).');
    }
    return this.rpc('create_route', {
      p_actor: actorId, p_origin: dto.origin, p_destination: dto.destination,
      p_departure_at: departureAt.toISOString(), p_seats: dto.seats, p_price: dto.price ?? 0, p_note: dto.note || null,
    });
  }

  remove(actorId: string, routeId: string) {
    return this.rpc('remove_route', { p_actor: actorId, p_route: routeId, p_confirm_cancel: false });
  }

  cancel(actorId: string, routeId: string) {
    return this.rpc('remove_route', { p_actor: actorId, p_route: routeId, p_confirm_cancel: true });
  }

  book(actorId: string, routeId: string, seats: number) {
    return this.rpc('book_route', { p_actor: actorId, p_route: routeId, p_seats: seats });
  }

  async myBookings(actorId: string) {
    const { data: bookings, error } = await this.supabase.getClient().from('bookings')
      .select('id,route_id,seats,status,passenger_finished_at,created_at').eq('passenger_id', actorId).order('created_at', { ascending: false }).limit(100);
    if (error) throwDatabaseError(error);
    if (!bookings?.length) return [];
    const { data: routes, error: routesError } = await this.supabase.getClient().from('route_catalog').select('*')
      .in('id', [...new Set(bookings.map((booking) => booking.route_id))]);
    if (routesError) throwDatabaseError(routesError);
    const byId = new Map((routes as RouteRow[]).map((row) => [row.id, presentRoute(row)]));
    return bookings.map((booking) => ({ id: booking.id, routeId: booking.route_id, seats: booking.seats,
      status: booking.status, passengerFinishedAt: booking.passenger_finished_at, createdAt: booking.created_at, route: byId.get(booking.route_id) }));
  }

  finish(actorId: string, routeId: string) {
    return this.rpc('finish_route', { p_actor: actorId, p_route: routeId });
  }

  rate(actorId: string, routeId: string, ratedId: string, score: number, comment?: string) {
    return this.rpc('submit_route_rating', {
      p_actor: actorId, p_route: routeId, p_rated: ratedId, p_score: score, p_comment: comment || null,
    });
  }

  private async rpc(name: string, parameters: Record<string, unknown>) {
    const { data, error } = await this.supabase.getClient().rpc(name, parameters);
    if (error) throwDatabaseError(error);
    return data;
  }
}
