import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import { throwDatabaseError } from '../common/database-error.js';
import type { CreateRouteDto, FindRoutesDto } from './dto/route.dto.js';
import { ChangeNotificationService } from '../notifications/change-notification.service.js';

export interface RouteRow {
  id: string; driver_id: string; driver_name: string; origin: string; destination: string;
  meeting_point: string;
  departure_at: string; seats: number; available_seats: number; price: number; note: string | null;
  status: string; confirmed_passengers: number; created_at: string;
  driver_finished_at: string | null; passenger_finished_at?: string | null;
}

export interface PaymentRow {
  id: string; booking_id: string; route_id: string; passenger_id: string;
  amount: number; status: string; confirmed_at: string | null; confirmed_by: string | null;
  created_at: string; passenger_name?: string;
}

export function presentRoute(row: RouteRow, driverPhotoUrl?: string | null) {
  // Colombia does not observe daylight-saving time. Store UTC, expose local date and time.
  const local = new Date(new Date(row.departure_at).getTime() - 5 * 60 * 60 * 1000).toISOString();
  return {
    id: row.id, driverId: row.driver_id, driverName: row.driver_name, driverPhotoUrl: driverPhotoUrl ?? null,
    origin: row.origin, destination: row.destination, meetingPoint: row.meeting_point,
    date: local.slice(0, 10), time: local.slice(11, 16),
    seats: row.seats, availableSeats: row.available_seats, price: Number(row.price), note: row.note,
    status: row.status, confirmedPassengers: row.confirmed_passengers, createdAt: row.created_at,
    driverFinishedAt: row.driver_finished_at, passengerFinishedAt: row.passenger_finished_at ?? null,
  };
}

@Injectable()
export class RoutesService {
  private readonly logger = new Logger(RoutesService.name);

  constructor(
    @Inject(SupabaseService) private readonly supabase: SupabaseService,
    @Inject(ChangeNotificationService) private readonly changeNotification: ChangeNotificationService,
  ) {}

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
    return this.presentRoutes(data as RouteRow[]);
  }

  async findMine(actorId: string) {
    const { data, error } = await this.supabase.getClient().from('route_catalog').select('*')
      .eq('driver_id', actorId).order('departure_at', { ascending: false }).limit(100);
    if (error) throwDatabaseError(error);
    return this.presentRoutes(data as RouteRow[]);
  }

  async create(actorId: string, dto: CreateRouteDto) {
    if (dto.origin.toLocaleLowerCase('es') === dto.destination.toLocaleLowerCase('es')) {
      throw new BadRequestException('El origen y el destino deben ser diferentes.');
    }
    const departureAt = new Date(`${dto.date}T${dto.time}:00-05:00`);
    if (!Number.isFinite(departureAt.getTime()) || departureAt.getTime() <= Date.now()) {
      throw new BadRequestException('La fecha y hora del viaje deben ser futuras (hora de Colombia).');
    }
    return this.rpc('create_route_v2', {
      p_actor: actorId, p_origin: dto.origin, p_destination: dto.destination,
      p_departure_at: departureAt.toISOString(), p_seats: dto.seats, p_price: dto.price ?? 0,
      p_note: dto.note || null, p_meeting_point: dto.meetingPoint,
    });
  }

  remove(actorId: string, routeId: string) {
    return this.rpc('remove_route', { p_actor: actorId, p_route: routeId, p_confirm_cancel: false });
  }

  /**
   * SCRUM-135: Cancela una ruta y emite el evento `route.cancelled`
   * para que ChangeNotificationService notifique a los pasajeros afectados.
   */
  async cancel(actorId: string, routeId: string) {
    const admin = this.supabase.getClient();

    // Obtener datos de la ruta y pasajeros ANTES de cancelar
    const [{ data: route }, { data: bookings }] = await Promise.all([
      admin.from('route_catalog').select('origin,destination,departure_at').eq('id', routeId).maybeSingle(),
      admin.from('bookings').select('passenger_id').eq('route_id', routeId).eq('status', 'confirmed'),
    ]);

    const result = await this.rpc('remove_route', { p_actor: actorId, p_route: routeId, p_confirm_cancel: true });

    // Emitir evento de cancelación (sin bloquear la respuesta al cliente)
    if (route) {
      const passengerIds = [...new Set((bookings ?? []).map((b) => b.passenger_id as string))];
      void this.changeNotification.dispatch({
        type: 'route.cancelled',
        routeId,
        origin: route.origin as string,
        destination: route.destination as string,
        departureAt: route.departure_at as string,
        passengerIds,
      }).catch((error) => this.logger.error(`Error emitiendo evento route.cancelled: ${String(error)}`));
    }

    return result;
  }

  requestBooking(actorId: string, routeId: string, seats: number) {
    return this.rpc('request_booking', { p_actor: actorId, p_route: routeId, p_seats: seats });
  }

  /**
   * SCRUM-135: Acepta una solicitud de reserva y emite el evento `booking.accepted`
   * para notificar al pasajero y confirmar al conductor.
   */
  async acceptBookingRequest(actorId: string, bookingId: string) {
    const admin = this.supabase.getClient();

    // Obtener datos del booking ANTES de aceptar
    const { data: booking } = await admin.from('bookings')
      .select('route_id,passenger_id').eq('id', bookingId).maybeSingle();

    const result = await this.rpc('accept_booking_request', { p_actor: actorId, p_booking: bookingId });

    // Emitir evento de reserva aceptada (sin bloquear la respuesta al cliente)
    if (booking) {
      const { data: route } = await admin.from('route_catalog')
        .select('origin,destination,departure_at,driver_id').eq('id', booking.route_id).maybeSingle();
      if (route) {
        void this.changeNotification.dispatch({
          type: 'booking.accepted',
          bookingId,
          routeId: booking.route_id as string,
          origin: route.origin as string,
          destination: route.destination as string,
          departureAt: route.departure_at as string,
          passengerId: booking.passenger_id as string,
          driverId: route.driver_id as string,
        }).catch((error) => this.logger.error(`Error emitiendo evento booking.accepted: ${String(error)}`));
      }
    }

    return result;
  }

  async pendingBookingRequests(actorId: string) {
    const admin = this.supabase.getClient();
    const { data: routes, error: routesError } = await admin.from('route_catalog').select('*')
      .eq('driver_id', actorId).eq('status', 'published').gt('departure_at', new Date().toISOString())
      .order('departure_at').limit(100);
    if (routesError) throwDatabaseError(routesError);
    if (!routes?.length) return [];
    const routeIds = routes.map((route) => route.id as string);
    const { data: requests, error } = await admin.from('bookings')
      .select('id,route_id,passenger_id,seats,status,created_at')
      .in('route_id', routeIds).eq('status', 'pending').order('created_at').limit(200);
    if (error) throwDatabaseError(error);
    if (!requests?.length) return [];
    const passengerIds = [...new Set(requests.map((request) => request.passenger_id as string))];
    const { data: passengers, error: passengerError } = await admin.from('profiles')
      .select('id,first_name,last_name,photo_url').in('id', passengerIds);
    if (passengerError) throwDatabaseError(passengerError);
    const routeById = new Map((routes as RouteRow[]).map((row) => [row.id, presentRoute(row)]));
    const passengerById = new Map((passengers ?? []).map((profile) => [profile.id as string, {
      name: [profile.first_name, profile.last_name].filter(Boolean).join(' '),
      photoUrl: profile.photo_url as string | null,
    }]));
    return requests.map((request) => ({
      id: request.id,
      routeId: request.route_id,
      passengerId: request.passenger_id,
      passengerName: passengerById.get(request.passenger_id as string)?.name || 'Pasajero',
      passengerPhotoUrl: passengerById.get(request.passenger_id as string)?.photoUrl ?? null,
      seats: request.seats,
      status: request.status,
      createdAt: request.created_at,
      route: routeById.get(request.route_id as string),
    }));
  }

  async myBookings(actorId: string) {
    const { data: bookings, error } = await this.supabase.getClient().from('bookings')
      .select('id,route_id,seats,status,passenger_finished_at,created_at').eq('passenger_id', actorId).order('created_at', { ascending: false }).limit(100);
    if (error) throwDatabaseError(error);
    if (!bookings?.length) return [];
    const { data: routes, error: routesError } = await this.supabase.getClient().from('route_catalog').select('*')
      .in('id', [...new Set(bookings.map((booking) => booking.route_id))]);
    if (routesError) throwDatabaseError(routesError);
    const presentedRoutes = await this.presentRoutes(routes as RouteRow[]);
    const byId = new Map(presentedRoutes.map((route) => [route.id, route]));
    return bookings.map((booking) => ({ id: booking.id, routeId: booking.route_id, seats: booking.seats,
      status: booking.status, passengerFinishedAt: booking.passenger_finished_at, createdAt: booking.created_at, route: byId.get(booking.route_id) }));
  }

  finish(actorId: string, routeId: string) {
    return this.rpc('finish_route', { p_actor: actorId, p_route: routeId });
  }

  async payments(actorId: string) {
    const routeIds = await this.ownedFinishedRouteIds(actorId);
    if (!routeIds.length) return [];
    const { data, error } = await this.supabase.getClient().from('trip_payments')
      .select('id,booking_id,route_id,passenger_id,amount,status,confirmed_at,confirmed_by,created_at')
      .eq('status', 'pending')
      .in('route_id', routeIds);
    if (error) throwDatabaseError(error);
    return this.presentPayments(data as PaymentRow[]);
  }

  async myPayments(actorId: string) {
    const { data, error } = await this.supabase.getClient().from('trip_payments')
      .select('id,booking_id,route_id,passenger_id,amount,status,confirmed_at,confirmed_by,created_at')
      .eq('passenger_id', actorId).order('created_at', { ascending: false }).limit(100);
    if (error) throwDatabaseError(error);
    return this.presentPayments(data as PaymentRow[]);
  }

  confirmPayment(actorId: string, paymentId: string) {
    return this.rpc('confirm_trip_payment', { p_actor: actorId, p_payment: paymentId });
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

  private async presentRoutes(rows: RouteRow[]) {
    if (!rows.length) return [];
    const driverIds = [...new Set(rows.map((row) => row.driver_id))];
    const { data: profiles, error } = await this.supabase.getClient().from('profiles')
      .select('id,photo_url').in('id', driverIds);
    if (error) throwDatabaseError(error);
    const photoUrls = new Map((profiles ?? []).map((profile) => [profile.id as string, profile.photo_url as string | null]));
    return rows.map((row) => presentRoute(row, photoUrls.get(row.driver_id)));
  }

  private async ownedFinishedRouteIds(actorId: string): Promise<string[]> {
    const { data, error } = await this.supabase.getClient().from('routes')
      .select('id').eq('driver_id', actorId).not('driver_finished_at', 'is', null);
    if (error) throwDatabaseError(error);
    return (data ?? []).map((row) => row.id as string);
  }

  private async presentPayments(rows: PaymentRow[]) {
    if (!rows.length) return [];
    const passengerIds = [...new Set(rows.map((row) => row.passenger_id))];
    const client = this.supabase.getClient();
    const { data, error } = await client.from('profiles')
      .select('id,first_name,last_name').in('id', passengerIds);
    if (error) throwDatabaseError(error);
    const { data: routeRows, error: routeError } = await client.from('route_catalog')
      .select('id,origin,destination,departure_at').in('id', [...new Set(rows.map((row) => row.route_id))]);
    if (routeError) throwDatabaseError(routeError);
    const names = new Map((data ?? []).map((profile) => [
      profile.id as string, [profile.first_name, profile.last_name].filter(Boolean).join(' '),
    ]));
    const routes = new Map((routeRows ?? []).map((route) => {
      const local = new Date(new Date(route.departure_at as string).getTime() - 5 * 60 * 60 * 1000).toISOString();
      return [route.id as string, {
        origin: route.origin as string, destination: route.destination as string,
        date: local.slice(0, 10), time: local.slice(11, 16),
      }];
    }));
    return rows.map((row) => ({
      id: row.id, bookingId: row.booking_id, routeId: row.route_id, passengerId: row.passenger_id,
      passengerName: names.get(row.passenger_id) || 'Pasajero', amount: Number(row.amount),
      status: row.status, confirmedAt: row.confirmed_at, confirmedBy: row.confirmed_by,
      createdAt: row.created_at, route: routes.get(row.route_id),
    }));
  }
}
