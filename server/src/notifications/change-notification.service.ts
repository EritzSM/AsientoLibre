import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../email/email.service.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { PushNotificationService } from '../reminders/push-notification.service.js';
import type { RouteEvent } from '../routes/events/route-events.js';

/**
 * SCRUM-137: Servicio central de notificaciones de cambio.
 *
 * Responsabilidades:
 *  - Recibe eventos de ruta (cambio de hora, cancelación, reserva aceptada)
 *  - Persiste notificaciones internas en la tabla `notifications`
 *  - Envía push via Firebase (FCM/APNS) a los dispositivos registrados
 *  - Envía correo electrónico vía Brevo
 *
 * Si push o email fallan, la notificación interna siempre se guarda.
 */

@Injectable()
export class ChangeNotificationService {
  private readonly logger = new Logger(ChangeNotificationService.name);
  private readonly frontendUrl: string;

  constructor(
    @Inject(SupabaseService) private readonly supabase: SupabaseService,
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(PushNotificationService) private readonly push: PushNotificationService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.frontendUrl = (config.get<string>('FRONTEND_URL') || 'http://localhost:5173').replace(/\/$/, '');
  }

  /**
   * Punto de entrada principal: recibe un RouteEvent y despacha las notificaciones.
   */
  async dispatch(event: RouteEvent): Promise<void> {
    switch (event.type) {
      case 'route.time_changed':
        await this.notifyTimeChanged(event);
        break;
      case 'route.cancelled':
        await this.notifyRouteCancelled(event);
        break;
      case 'booking.accepted':
        await this.notifyBookingAccepted(event);
        break;
    }
  }

  // ─── Cambio de hora ────────────────────────────────────────────────────────

  private async notifyTimeChanged(event: Extract<RouteEvent, { type: 'route.time_changed' }>): Promise<void> {
    const oldLocal = this.toLocalTime(event.oldDepartureAt);
    const newLocal = this.toLocalTime(event.newDepartureAt);
    const title = '⏰ Cambio de horario en tu viaje';
    const message = `El viaje de ${event.origin} a ${event.destination} cambió su hora de salida de ${oldLocal} a ${newLocal}. Puedes mantener o cancelar tu reserva.`;
    const link = `${this.frontendUrl}/index.html?trip=${encodeURIComponent(event.routeId)}`;

    await Promise.allSettled(
      event.passengerIds.map((passengerId) =>
        this.sendToUser(passengerId, {
          routeId: event.routeId,
          type: 'time_changed',
          title,
          message,
          link,
          metadata: {
            oldDepartureAt: event.oldDepartureAt,
            newDepartureAt: event.newDepartureAt,
          },
        }),
      ),
    );
  }

  // ─── Cancelación de ruta ──────────────────────────────────────────────────

  private async notifyRouteCancelled(event: Extract<RouteEvent, { type: 'route.cancelled' }>): Promise<void> {
    const departureDateLocal = this.toLocalTime(event.departureAt);
    const title = '🚫 Ruta cancelada';
    const message = `La ruta de ${event.origin} a ${event.destination} programada para el ${departureDateLocal} fue cancelada por el conductor. Consulta las rutas alternativas disponibles.`;
    const link = `${this.frontendUrl}/index.html`;

    await Promise.allSettled(
      event.passengerIds.map((passengerId) =>
        this.sendToUser(passengerId, {
          routeId: event.routeId,
          type: 'route_cancelled',
          title,
          message,
          link,
          metadata: { cancelledRouteId: event.routeId },
        }),
      ),
    );
  }

  // ─── Reserva aceptada ─────────────────────────────────────────────────────

  private async notifyBookingAccepted(event: Extract<RouteEvent, { type: 'booking.accepted' }>): Promise<void> {
    const departureDateLocal = this.toLocalTime(event.departureAt);
    const title = '✅ ¡Tu reserva fue confirmada!';
    const message = `Tu solicitud de cupo para el viaje de ${event.origin} a ${event.destination} del ${departureDateLocal} fue aceptada por el conductor.`;
    const link = `${this.frontendUrl}/index.html?trip=${encodeURIComponent(event.routeId)}`;

    await this.sendToUser(event.passengerId, {
      routeId: event.routeId,
      type: 'booking_accepted',
      title,
      message,
      link,
      metadata: { bookingId: event.bookingId },
    });

    // También notificar al conductor que acaba de aceptar (confirmación interna)
    const driverTitle = '🔔 Nueva reserva en tu ruta';
    const driverMessage = `Aceptaste una reserva para el viaje de ${event.origin} a ${event.destination} del ${departureDateLocal}.`;
    await this.sendToUser(event.driverId, {
      routeId: event.routeId,
      type: 'new_booking',
      title: driverTitle,
      message: driverMessage,
      link,
      metadata: { bookingId: event.bookingId, passengerId: event.passengerId },
    });
  }

  // ─── Canal unificado ──────────────────────────────────────────────────────

  private async sendToUser(
    userId: string,
    input: {
      routeId: string;
      type: string;
      title: string;
      message: string;
      link: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const admin = this.supabase.getClient();

    // 1. Persistir notificación interna (siempre, independiente de push/email)
    const { error: insertError } = await admin.from('notifications').insert({
      recipient_id: userId,
      route_id: input.routeId,
      type: input.type,
      title: input.title,
      message: input.message,
      metadata: input.metadata ?? {},
    });
    if (insertError) {
      this.logger.error(`No se pudo guardar la notificación ${input.type} para ${userId}: ${insertError.message}`);
    }

    // 2. Obtener datos de contacto del usuario
    const [{ data: profile }, { data: authResult, error: authError }] = await Promise.all([
      admin.from('profiles').select('first_name,last_name').eq('id', userId).maybeSingle(),
      admin.auth.admin.getUserById(userId),
    ]);

    const recipientName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || 'Viajero/a';
    const emailAddress = authResult?.user?.email;

    // 3. Push y email en paralelo, sin bloquear si fallan
    const [emailResult, pushResult] = await Promise.allSettled([
      authError || !emailAddress
        ? Promise.resolve({ success: false })
        : this.email.sendTripNotificationEmail({
            toEmail: emailAddress,
            recipientName,
            subject: input.title,
            title: input.title,
            message: input.message,
            actionUrl: input.link,
          }),
      this.push.sendToUser(userId, {
        title: input.title,
        body: input.message,
        link: input.link,
        data: {
          routeId: input.routeId,
          type: input.type,
        },
      }),
    ]);

    if (emailResult.status === 'rejected' || (emailResult.status === 'fulfilled' && !emailResult.value.success)) {
      this.logger.warn(`Correo de cambio (${input.type}) no entregado a ${userId}.`);
    }
    if (pushResult.status === 'rejected') {
      this.logger.warn(`Push de cambio (${input.type}) falló para ${userId}: ${String(pushResult.reason)}`);
    }
  }

  private toLocalTime(isoUtc: string): string {
    return new Date(isoUtc).toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }
}
