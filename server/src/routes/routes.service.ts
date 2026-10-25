import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
    const result = await this.rpc('create_route_v2', {
      p_actor: actorId, p_origin: dto.origin, p_destination: dto.destination,
      p_departure_at: departureAt.toISOString(), p_seats: dto.seats, p_price: dto.price ?? 0,
      p_note: dto.note || null, p_meeting_point: dto.meetingPoint,
    });
    const routeId = (result as Record<string, unknown>)?.id as string | undefined;
    if (routeId) await this.notifyFavoritePassengers(routeId, dto.origin, dto.destination, departureAt.toISOString());
    return result;
  }

  async favorites(actorId: string) {
    await this.ensurePassenger(actorId);
    const client = this.supabase.getClient();
    const { data: favorites, error } = await client.from('route_favorites')
      .select('id,source_route_id,origin,destination,origin_key,destination_key,created_at')
      .eq('passenger_id', actorId).order('created_at', { ascending: false }).limit(100);
    if (error) throwDatabaseError(error);
    if (!favorites?.length) return [];

    const { data: routes, error: routesError } = await client.from('route_catalog').select('*')
      .eq('status', 'published').gt('departure_at', new Date().toISOString()).gt('available_seats', 0)
      .order('departure_at').limit(200);
    if (routesError) throwDatabaseError(routesError);
    const presented = await this.presentRoutes((routes ?? []) as RouteRow[]);
    return favorites.map((favorite) => ({
      id: favorite.id as string,
      sourceRouteId: favorite.source_route_id as string | null,
      origin: favorite.origin as string,
      destination: favorite.destination as string,
      createdAt: favorite.created_at as string,
      availableRoutes: presented.filter((route) =>
        this.normalizePlace(route.origin) === favorite.origin_key
        && this.normalizePlace(route.destination) === favorite.destination_key),
    }));
  }

  saveFavorite(actorId: string, routeId: string) {
    return this.rpc('save_route_favorite', { p_actor: actorId, p_route: routeId });
  }

  removeFavorite(actorId: string, favoriteId: string) {
    return this.rpc('remove_route_favorite', { p_actor: actorId, p_favorite: favoriteId });
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

    // Obtener datos de la ruta y de TODOS los pasajeros involucrados
    // (reservas confirmadas, solicitudes pendientes, y registros de asistencia)
    const [{ data: route }, { data: bookings }, { data: attendances }] = await Promise.all([
      admin.from('route_catalog').select('origin,destination,departure_at,driver_id').eq('id', routeId).maybeSingle(),
      admin.from('bookings').select('passenger_id,status').eq('route_id', routeId).in('status', ['confirmed', 'pending']),
      admin.from('trip_attendance').select('user_id').eq('route_id', routeId).eq('role', 'passenger').neq('status', 'cancelled'),
    ]);

    if (!route) {
      throw new NotFoundException('La ruta no existe.');
    }
    if (route.driver_id !== actorId) {
      throw new ForbiddenException('Solo el conductor propietario puede retirar esta ruta.');
    }

    const passengerIds = [...new Set([
      ...(bookings ?? []).map((b) => b.passenger_id as string),
      ...(attendances ?? []).map((a) => a.user_id as string),
    ])];

    let result: unknown = null;
    try {
      result = await this.rpc('remove_route', { p_actor: actorId, p_route: routeId, p_confirm_cancel: true });
    } catch (rpcErr) {
      this.logger.warn(`remove_route RPC no disponible (${String(rpcErr)}), aplicando actualización directa`);
      const { data: updated, error: uError } = await admin.from('routes')
        .update({ status: passengerIds.length > 0 ? 'cancelled' : 'deleted', updated_at: new Date().toISOString() })
        .eq('id', routeId)
        .select()
        .single();
      if (uError) throwDatabaseError(uError);
      result = updated;
    }

    // Asegurar que todas las reservas/solicitudes queden como cancelled
    await admin.from('bookings')
      .update({ status: 'cancelled', responded_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('route_id', routeId)
      .in('status', ['confirmed', 'pending']);

    // Asegurar que las asistencias queden como cancelled para limpiar los recordatorios
    await admin.from('trip_attendance')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('route_id', routeId);

    // Emitir evento route.cancelled para notificar a TODOS los pasajeros por Email y Push
    if (passengerIds.length > 0) {
      void this.changeNotification.dispatch({
        type: 'route.cancelled',
        routeId,
        origin: route.origin as string,
        destination: route.destination as string,
        departureAt: route.departure_at as string,
        passengerIds,
      }).catch((error) => this.logger.error(`Error emitiendo evento route.cancelled: ${String(error)}`));
    }

    return result ?? { message: 'Ruta cancelada exitosamente.', notifiedPassengers: passengerIds.length };
  }

  requestBooking(actorId: string, routeId: string, seats: number) {
    return this.requestBookingWithPromotion(actorId, routeId, seats, null);
  }

  async requestBookingWithPromotion(actorId: string, routeId: string, seats: number, promotionId: string | null) {
    const admin = this.supabase.getClient();
    const { data: route } = await admin.from('route_catalog')
      .select('origin,destination,departure_at,status,driver_id').eq('id', routeId).maybeSingle();

    if (route?.departure_at) {
      const departureTime = new Date(route.departure_at as string).getTime();
      if (departureTime - Date.now() <= 5 * 60 * 1000) {
        throw new ConflictException('No se pueden solicitar cupos si faltan menos de 5 minutos para la salida del viaje.');
      }
    }

    const result = await this.rpc('request_booking_with_promotion', {
      p_actor: actorId, p_route: routeId, p_seats: seats, p_promotion: promotionId,
    });

    // SCRUM-140: Notificar inmediatamente al conductor de la nueva solicitud de cupo
    if (route?.driver_id) {
      const { data: passenger } = await admin.from('profiles')
        .select('first_name,last_name').eq('id', actorId).maybeSingle();
      const passengerName = [passenger?.first_name, passenger?.last_name].filter(Boolean).join(' ') || 'Un pasajero';
      const bookingId = (result as Record<string, unknown>)?.id as string | undefined;

      void this.changeNotification.dispatch({
        type: 'booking.requested',
        bookingId,
        routeId,
        origin: route.origin as string,
        destination: route.destination as string,
        departureAt: route.departure_at as string,
        passengerId: actorId,
        passengerName,
        driverId: route.driver_id as string,
        seats,
      }).catch((error) => this.logger.error(`Error emitiendo evento booking.requested: ${String(error)}`));
    }

    return result;
  }

  async activePromotions() {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase.getClient().from('promotions')
      .select('id,title,description,code,discount_type,discount_value,starts_at,ends_at')
      .eq('is_active', true).lte('starts_at', now).gt('ends_at', now)
      .order('ends_at');
    if (error) throwDatabaseError(error);
    return (data ?? []).map((promotion) => ({
      id: promotion.id as string,
      title: promotion.title as string,
      description: promotion.description as string,
      code: promotion.code as string | null,
      discountType: promotion.discount_type as 'percentage' | 'fixed',
      discountValue: Number(promotion.discount_value),
      startsAt: promotion.starts_at as string,
      endsAt: promotion.ends_at as string,
    }));
  }

  /**
   * SCRUM-135: Acepta una solicitud de reserva y emite el evento `booking.accepted`
   * para notificar al pasajero y confirmar al conductor.
   */
  async acceptBookingRequest(actorId: string, bookingId: string) {
    const admin = this.supabase.getClient();

    // Obtener datos del booking ANTES de aceptar
    const { data: booking } = await admin.from('bookings')
      .select('route_id,passenger_id,seats').eq('id', bookingId).maybeSingle();

    if (booking?.route_id) {
      const { data: route } = await admin.from('route_catalog')
        .select('origin,destination,departure_at,driver_id').eq('id', booking.route_id).maybeSingle();
      if (route?.departure_at) {
        const departureTime = new Date(route.departure_at as string).getTime();
        if (departureTime - Date.now() <= 5 * 60 * 1000) {
          throw new ConflictException('No se pueden aceptar solicitudes si faltan menos de 5 minutos para la salida del viaje.');
        }
      }
    }

    let result: unknown = null;
    try {
      result = await this.rpc('accept_booking_request', { p_actor: actorId, p_booking: bookingId });
    } catch (rpcErr: any) {
      this.logger.warn(`RPC accept_booking_request no disponible (${rpcErr?.message}), aplicando actualización directa en tabla bookings`);
      const { data: updated, error: uError } = await admin.from('bookings')
        .update({ status: 'confirmed', responded_at: new Date().toISOString() })
        .eq('id', bookingId)
        .select()
        .single();
      if (uError) throwDatabaseError(uError);
      result = updated;
    }

    // Emitir evento de reserva aceptada (sin bloquear la respuesta al cliente)
    if (booking?.route_id) {
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

  /**
   * Rechaza una solicitud de cupo por parte del conductor.
   */
  async rejectBookingRequest(actorId: string, bookingId: string) {
    const admin = this.supabase.getClient();

    const { data: booking, error: bError } = await admin.from('bookings')
      .select('route_id,passenger_id,seats,status').eq('id', bookingId).maybeSingle();

    if (bError) throwDatabaseError(bError);
    if (!booking) throw new NotFoundException('La solicitud no existe.');

    const { data: route, error: rError } = await admin.from('route_catalog')
      .select('origin,destination,departure_at,driver_id').eq('id', booking.route_id).maybeSingle();

    if (rError) throwDatabaseError(rError);
    if (!route) throw new NotFoundException('La ruta no existe.');

    if (route.driver_id !== actorId) {
      throw new ForbiddenException('Solo el conductor de la ruta puede rechazar esta solicitud.');
    }

    const departureTime = new Date(route.departure_at as string).getTime();
    if (departureTime - Date.now() <= 5 * 60 * 1000) {
      throw new ConflictException('No se pueden rechazar solicitudes si faltan menos de 5 minutos para la salida del viaje.');
    }

    if (booking.status !== 'pending') {
      throw new ConflictException('La solicitud ya no está pendiente.');
    }

    let result: unknown = null;
    try {
      result = await this.rpc('reject_booking_request', { p_actor: actorId, p_booking: bookingId });
    } catch (rpcErr: any) {
      this.logger.warn(`RPC reject_booking_request no disponible (${rpcErr?.message}), aplicando actualización directa en tabla bookings`);
      const { data: updated, error: uError } = await admin.from('bookings')
        .update({ status: 'cancelled', responded_at: new Date().toISOString() })
        .eq('id', bookingId)
        .select()
        .single();
      if (uError) throwDatabaseError(uError);
      result = updated;
    }

    void this.changeNotification.dispatch({
      type: 'booking.rejected',
      bookingId,
      routeId: booking.route_id as string,
      origin: route.origin as string,
      destination: route.destination as string,
      departureAt: route.departure_at as string,
      passengerId: booking.passenger_id as string,
      driverId: route.driver_id as string,
      seats: Number(booking.seats) || 1,
    }).catch((error) => this.logger.error(`Error emitiendo evento booking.rejected: ${String(error)}`));

    return result;
  }

  /**
   * Cancela una solicitud o reserva de cupo por parte del pasajero.
   */
  async cancelBooking(actorId: string, bookingId: string) {
    const admin = this.supabase.getClient();

    const { data: booking, error: bError } = await admin.from('bookings')
      .select('route_id,passenger_id,seats,status').eq('id', bookingId).maybeSingle();

    if (bError) throwDatabaseError(bError);
    if (!booking) throw new NotFoundException('La reserva o solicitud no existe.');

    if (booking.passenger_id !== actorId) {
      throw new ForbiddenException('Solo el pasajero que solicitó el cupo puede cancelar esta reserva.');
    }

    if (booking.status === 'cancelled') {
      throw new ConflictException('Esta solicitud o reserva ya está cancelada.');
    }

    const { data: route, error: rError } = await admin.from('route_catalog')
      .select('origin,destination,departure_at,driver_id').eq('id', booking.route_id).maybeSingle();

    if (rError) throwDatabaseError(rError);
    if (!route) throw new NotFoundException('La ruta no existe.');

    const departureTime = new Date(route.departure_at as string).getTime();
    if (departureTime - Date.now() <= 5 * 60 * 1000) {
      throw new ConflictException('No se puede cancelar una solicitud o reserva si faltan menos de 5 minutos para la salida del viaje.');
    }

    const wasConfirmed = booking.status === 'confirmed';

    let result: unknown = null;
    try {
      result = await this.rpc('cancel_booking_by_passenger', { p_actor: actorId, p_booking: bookingId });
    } catch (rpcErr: any) {
      this.logger.warn(`RPC cancel_booking_by_passenger no disponible (${rpcErr?.message}), aplicando actualización directa en tabla bookings`);
      const { data: updated, error: uError } = await admin.from('bookings')
        .update({ status: 'cancelled', responded_at: new Date().toISOString() })
        .eq('id', bookingId)
        .select()
        .single();
      if (uError) throwDatabaseError(uError);
      result = updated;
    }

    void this.changeNotification.dispatch({
      type: 'booking.cancelled',
      bookingId,
      routeId: booking.route_id as string,
      origin: route.origin as string,
      destination: route.destination as string,
      departureAt: route.departure_at as string,
      passengerId: booking.passenger_id as string,
      driverId: route.driver_id as string,
      seats: Number(booking.seats) || 1,
      cancelledBy: 'passenger',
      wasConfirmed,
    }).catch((error) => this.logger.error(`Error emitiendo evento booking.cancelled: ${String(error)}`));

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
      .select('id,route_id,passenger_id,seats,status,created_at,promotion_id,discount_amount,total_amount')
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
      promotionId: request.promotion_id,
      discountAmount: Number(request.discount_amount),
      totalAmount: Number(request.total_amount),
      route: routeById.get(request.route_id as string),
    }));
  }

  async myBookings(actorId: string) {
    const { data: bookings, error } = await this.supabase.getClient().from('bookings')
      .select('id,route_id,seats,status,passenger_finished_at,created_at,promotion_id,discount_amount,total_amount').eq('passenger_id', actorId).order('created_at', { ascending: false }).limit(100);
    if (error) throwDatabaseError(error);
    if (!bookings?.length) return [];
    const { data: routes, error: routesError } = await this.supabase.getClient().from('route_catalog').select('*')
      .in('id', [...new Set(bookings.map((booking) => booking.route_id))]);
    if (routesError) throwDatabaseError(routesError);
    const presentedRoutes = await this.presentRoutes(routes as RouteRow[]);
    const byId = new Map(presentedRoutes.map((route) => [route.id, route]));
    return bookings.map((booking) => ({ id: booking.id, routeId: booking.route_id, seats: booking.seats,
      status: booking.status, passengerFinishedAt: booking.passenger_finished_at, createdAt: booking.created_at,
      promotionId: booking.promotion_id, discountAmount: Number(booking.discount_amount), totalAmount: Number(booking.total_amount),
      route: byId.get(booking.route_id) }));
  }

  finish(actorId: string, routeId: string) {
    return this.rpc('finish_route', { p_actor: actorId, p_route: routeId });
  }

  pendingRatingTargets(actorId: string, routeId: string) {
    return this.rpc('get_pending_route_rating_targets', { p_actor: actorId, p_route: routeId });
  }

  async payments(actorId: string) {
    return (await this.ownedPayments(actorId)).filter((payment) => payment.status === 'pending');
  }

  async ownedPayments(actorId: string) {
    const routeIds = await this.ownedFinishedRouteIds(actorId);
    if (!routeIds.length) return [];
    const { data, error } = await this.supabase.getClient().from('trip_payments')
      .select('id,booking_id,route_id,passenger_id,amount,status,confirmed_at,confirmed_by,created_at')
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

  ratingSummary(actorId: string) {
    return this.rpc('get_profile_rating_summary', { p_profile: actorId });
  }

  private async rpc(name: string, parameters: Record<string, unknown>) {
    const { data, error } = await this.supabase.getClient().rpc(name, parameters);
    if (error) throwDatabaseError(error);
    return data;
  }

  private normalizePlace(value: string) {
    return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
  }

  private async ensurePassenger(actorId: string) {
    const { data, error } = await this.supabase.getClient().from('profiles')
      .select('role,is_active').eq('id', actorId).maybeSingle();
    if (error) throwDatabaseError(error);
    if (!data || data.role !== 'pasajero' || !data.is_active) {
      throw new ForbiddenException('Solo un pasajero activo puede consultar rutas favoritas.');
    }
  }

  private async notifyFavoritePassengers(routeId: string, origin: string, destination: string, departureAt: string) {
    const client = this.supabase.getClient();
    const { data, error } = await client.from('route_favorites').select('passenger_id')
      .eq('origin_key', this.normalizePlace(origin)).eq('destination_key', this.normalizePlace(destination));
    if (error) {
      this.logger.warn(`No se pudieron consultar favoritos para la ruta ${routeId}: ${error.message}`);
      return;
    }
    const passengerIds = [...new Set((data ?? []).map((favorite) => favorite.passenger_id as string))];
    if (!passengerIds.length) return;
    const departure = new Date(departureAt).toLocaleString('es-CO', {
      timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short',
    });
    await Promise.allSettled(passengerIds.map((passengerId) => this.changeNotification.sendToUser(passengerId, {
      routeId,
      type: 'favorite_route_available',
      title: 'Nueva ruta favorita disponible',
      message: `Se publicó un nuevo viaje de ${origin} a ${destination} para el ${departure}.`,
      link: `${this.changeNotification.frontendUrl}/index.html#rutas-favoritas`,
      metadata: { origin, destination, departureAt, action: 'reserve_favorite' },
    })));
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
