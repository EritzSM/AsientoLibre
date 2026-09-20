import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import { throwDatabaseError } from '../common/database-error.js';
import { ReminderDispatcherService } from './reminder-dispatcher.service.js';

type AttendanceStatus = 'pending' | 'confirmed' | 'release_suggested' | 'released' | 'cancelled';

interface RouteRecord {
  id: string;
  driver_id: string;
  origin: string;
  destination: string;
  meeting_point: string;
  departure_at: string;
  status: string;
}

@Injectable()
export class RemindersService {
  constructor(
    @Inject(SupabaseService) private readonly supabase: SupabaseService,
    @Inject(ReminderDispatcherService) private readonly dispatcher: ReminderDispatcherService,
  ) {}

  async savePushToken(actorId: string, token: string, platform: 'web' | 'android' | 'ios') {
    const { error } = await this.supabase.getClient().from('push_tokens').upsert({
      user_id: actorId,
      token,
      platform,
      updated_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    }, { onConflict: 'token' });
    if (error) throwDatabaseError(error);
    return { success: true, message: 'Dispositivo registrado para notificaciones.' };
  }

  async removePushToken(actorId: string, token: string) {
    const { error } = await this.supabase.getClient().from('push_tokens')
      .delete().eq('user_id', actorId).eq('token', token);
    if (error) throwDatabaseError(error);
    return { success: true };
  }

  async dashboard(actorId: string) {
    const admin = this.supabase.getClient();
    const { data: actor, error: actorError } = await admin.from('profiles')
      .select('role').eq('id', actorId).maybeSingle();
    if (actorError || !actor) throw new NotFoundException('Perfil no encontrado.');

    let routes: RouteRecord[] = [];
    const now = new Date();
    if (actor.role === 'conductor') {
      const { data, error } = await admin.from('routes')
        .select('id,driver_id,origin,destination,meeting_point,departure_at,status')
        .eq('driver_id', actorId).eq('status', 'published').gt('departure_at', now.toISOString())
        .order('departure_at').limit(100);
      if (error) throwDatabaseError(error);
      routes = (data ?? []) as RouteRecord[];
    } else {
      const { data: bookings, error: bookingsError } = await admin.from('bookings')
        .select('route_id').eq('passenger_id', actorId).eq('status', 'confirmed');
      if (bookingsError) throwDatabaseError(bookingsError);
      const routeIds = [...new Set((bookings ?? []).map((booking) => booking.route_id as string))];
      if (routeIds.length) {
        const { data, error } = await admin.from('routes')
          .select('id,driver_id,origin,destination,meeting_point,departure_at,status')
          .in('id', routeIds).eq('status', 'published').gt('departure_at', now.toISOString())
          .order('departure_at').limit(100);
        if (error) throwDatabaseError(error);
        routes = (data ?? []) as RouteRecord[];
      }
    }
    if (!routes.length) return [];

    const routeIds = routes.map((route) => route.id);
    const { data: attendance, error: attendanceError } = await admin.from('trip_attendance')
      .select('route_id,user_id,role,status,confirmed_at').in('route_id', routeIds);
    if (attendanceError) throwDatabaseError(attendanceError);
    const userIds = [...new Set((attendance ?? []).map((item) => item.user_id as string))];
    const { data: profiles, error: profileError } = userIds.length
      ? await admin.from('profiles').select('id,first_name,last_name,phone').in('id', userIds)
      : { data: [], error: null };
    if (profileError) throwDatabaseError(profileError);
    const profileById = new Map((profiles ?? []).map((profile) => [profile.id as string, profile]));

    return routes.map((route) => {
      const routeAttendance = (attendance ?? []).filter((item) => item.route_id === route.id);
      const mine = routeAttendance.find((item) => item.user_id === actorId);
      const counterparts = routeAttendance.filter((item) => item.user_id !== actorId && !['cancelled', 'released'].includes(item.status));
      return {
        routeId: route.id,
        role: actor.role === 'conductor' ? 'driver' : 'passenger',
        status: (mine?.status ?? 'pending') as AttendanceStatus,
        confirmedAt: mine?.confirmed_at ?? null,
        origin: route.origin,
        destination: route.destination,
        meetingPoint: route.meeting_point,
        startsAt: route.departure_at,
        minutesUntil: Math.max(0, Math.ceil((new Date(route.departure_at).getTime() - now.getTime()) / 60000)),
        participants: counterparts.map((item) => {
          const profile = profileById.get(item.user_id as string);
          return {
            userId: item.user_id,
            name: [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || 'Participante',
            phone: profile?.phone ?? '',
            role: item.role,
            status: item.status as AttendanceStatus,
            confirmedAt: item.confirmed_at ?? null,
          };
        }),
      };
    });
  }

  async attendanceForRoute(actorId: string, routeId: string) {
    const routes = await this.dashboard(actorId);
    const route = routes.find((item) => item.routeId === routeId);
    if (!route) throw new NotFoundException('La ruta no existe o ya no está activa.');
    if (route.role !== 'driver') throw new ForbiddenException('Solo el conductor puede consultar la asistencia de todos los pasajeros.');
    return { routeId, passengers: route.participants.filter((participant) => participant.role === 'passenger') };
  }

  async confirm(actorId: string, routeId: string) {
    const admin = this.supabase.getClient();
    const { data, error } = await admin.rpc('confirm_trip_attendance', { p_actor: actorId, p_route: routeId });
    if (error) throwDatabaseError(error);

    const [{ data: route }, { data: actor }] = await Promise.all([
      admin.from('routes').select('driver_id,origin,destination').eq('id', routeId).maybeSingle(),
      admin.from('profiles').select('first_name,last_name').eq('id', actorId).maybeSingle(),
    ]);
    if (route) {
      let recipients: string[];
      if (route.driver_id === actorId) {
        const { data: bookings } = await admin.from('bookings').select('passenger_id')
          .eq('route_id', routeId).eq('status', 'confirmed');
        recipients = (bookings ?? []).map((booking) => booking.passenger_id as string);
      } else {
        recipients = [route.driver_id as string];
      }
      const actorName = [actor?.first_name, actor?.last_name].filter(Boolean).join(' ') || 'Un participante';
      await Promise.allSettled(recipients.map((recipientId) => this.dispatcher.dispatch(recipientId, {
        routeId,
        type: 'attendance_confirmed',
        title: 'Asistencia confirmada',
        message: `${actorName} confirmó su asistencia al viaje de ${route.origin} a ${route.destination}.`,
      })));
    }
    return data;
  }

  async release(actorId: string, routeId: string, passengerId: string) {
    const { data, error } = await this.supabase.getClient().rpc('release_unconfirmed_seat', {
      p_actor: actorId,
      p_route: routeId,
      p_passenger: passengerId,
    });
    if (error) throwDatabaseError(error);
    return data;
  }
}
