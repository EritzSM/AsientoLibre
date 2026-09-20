import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { SupabaseService } from '../supabase/supabase.service.js';
import { ReminderDispatcherService } from './reminder-dispatcher.service.js';

interface ClaimedReminder {
  id: string;
  route_id: string;
  recipient_id: string;
  subject_user_id: string | null;
  kind: '24h' | '1h' | '30m_missing';
  origin: string;
  destination: string;
  meeting_point: string;
  departure_at: string;
  recipient_name: string;
  attendance_role: 'driver' | 'passenger';
}

@Injectable()
export class ReminderSchedulerService {
  private readonly logger = new Logger(ReminderSchedulerService.name);
  private readonly workerId = `api-${randomUUID()}`;

  constructor(
    @Inject(SupabaseService) private readonly supabase: SupabaseService,
    @Inject(ReminderDispatcherService) private readonly dispatcher: ReminderDispatcherService,
  ) {}

  @Cron('0 * * * * *', { name: 'trip-reminders', waitForCompletion: true })
  async runScheduled(): Promise<void> {
    try {
      const result = await this.processDueReminders();
      if (result.claimed) this.logger.log(`Recordatorios procesados: ${result.sent}/${result.claimed}.`);
    } catch (error: unknown) {
      this.logger.error(`Falló el scheduler de recordatorios: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async processDueReminders(now = new Date()): Promise<{ claimed: number; sent: number; failed: number }> {
    const admin = this.supabase.getClient();
    const { data, error } = await admin.rpc('claim_due_trip_reminders', {
      p_worker: this.workerId,
      p_limit: 50,
      p_now: now.toISOString(),
    });
    if (error) throw new Error(`No se pudo reclamar la cola de recordatorios: ${error.message}`);
    const deliveries = (data ?? []) as ClaimedReminder[];
    let sent = 0;

    for (const delivery of deliveries) {
      try {
        const notification = await this.buildNotification(delivery);
        if (!notification) {
          await admin.from('trip_reminder_deliveries').update({ status: 'skipped', worker_id: null })
            .eq('id', delivery.id).eq('status', 'processing');
          continue;
        }
        const { error: notificationError } = await admin.from('notifications').insert({
          route_id: delivery.route_id,
          recipient_id: delivery.recipient_id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          metadata: { action: notification.action },
        });
        if (notificationError && notificationError.code !== '23505') {
          throw new Error(notificationError?.message || 'No se pudo guardar la notificación.');
        }
        await this.dispatcher.dispatch(delivery.recipient_id, {
          routeId: delivery.route_id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
        });
        await admin.rpc('complete_trip_reminder_delivery', {
          p_delivery: delivery.id,
          p_success: true,
          p_error: null,
        });
        sent += 1;
      } catch (deliveryError: unknown) {
        const message = deliveryError instanceof Error ? deliveryError.message : String(deliveryError);
        await admin.rpc('complete_trip_reminder_delivery', {
          p_delivery: delivery.id,
          p_success: false,
          p_error: message,
        });
        this.logger.warn(`Recordatorio ${delivery.id} pendiente de reintento: ${message}`);
      }
    }
    return { claimed: deliveries.length, sent, failed: deliveries.length - sent };
  }

  private async buildNotification(delivery: ClaimedReminder): Promise<{
    type: string;
    title: string;
    message: string;
    action: string;
  } | null> {
    const admin = this.supabase.getClient();
    const departure = new Date(delivery.departure_at).toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      dateStyle: 'long',
      timeStyle: 'short',
    });
    const routeLabel = `${delivery.origin} a ${delivery.destination}`;

    if (delivery.kind === '24h') {
      return {
        type: 'trip_reminder_24h',
        title: 'Tu viaje es mañana',
        message: `Recuerda tu viaje de ${routeLabel}, programado para ${departure}. Punto de encuentro: ${delivery.meeting_point}.`,
        action: 'confirm_attendance',
      };
    }

    if (delivery.kind === '1h') {
      const contact = await this.counterpartContact(delivery);
      return {
        type: 'trip_reminder_1h',
        title: 'Tu viaje comienza en una hora',
        message: `Viaje de ${routeLabel}. Punto de encuentro: ${delivery.meeting_point}.${contact ? ` Contacto: ${contact}.` : ''}`,
        action: 'confirm_attendance',
      };
    }

    const { data: missing, error } = await admin.from('trip_attendance')
      .select('user_id,status').eq('route_id', delivery.route_id).eq('role', 'passenger')
      .in('status', ['pending', 'release_suggested']);
    if (error) throw error;
    if (!missing?.length) return null;
    const ids = missing.map((item) => item.user_id as string);
    const { data: profiles, error: profileError } = await admin.from('profiles')
      .select('id,first_name,last_name,phone').in('id', ids);
    if (profileError) throw profileError;
    const names = (profiles ?? []).map((profile) => {
      const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
      return profile.phone ? `${name} (${profile.phone})` : name;
    }).join(', ');
    await admin.from('trip_attendance').update({ status: 'release_suggested', updated_at: new Date().toISOString() })
      .eq('route_id', delivery.route_id).eq('role', 'passenger').in('status', ['pending', 'release_suggested']);
    return {
      type: 'attendance_missing',
      title: 'Pasajeros sin confirmar asistencia',
      message: `${names || 'Uno o más pasajeros'} no ha confirmado el viaje de ${routeLabel}. Puedes liberar sus cupos desde Mis rutas.`,
      action: 'review_attendance',
    };
  }

  private async counterpartContact(delivery: ClaimedReminder): Promise<string> {
    const admin = this.supabase.getClient();
    if (delivery.attendance_role === 'passenger') {
      const { data: route } = await admin.from('routes').select('driver_id').eq('id', delivery.route_id).maybeSingle();
      if (!route) return '';
      const { data: profile } = await admin.from('profiles').select('first_name,last_name,phone')
        .eq('id', route.driver_id).maybeSingle();
      return profile ? [profile.first_name, profile.last_name, profile.phone].filter(Boolean).join(' · ') : '';
    }
    const { data: attendance } = await admin.from('trip_attendance').select('user_id')
      .eq('route_id', delivery.route_id).eq('role', 'passenger').in('status', ['pending', 'confirmed', 'release_suggested']);
    const ids = (attendance ?? []).map((item) => item.user_id as string);
    if (!ids.length) return '';
    const { data: profiles } = await admin.from('profiles').select('first_name,last_name,phone').in('id', ids);
    return (profiles ?? []).map((profile) => [profile.first_name, profile.last_name, profile.phone]
      .filter(Boolean).join(' · ')).join('; ');
  }
}
