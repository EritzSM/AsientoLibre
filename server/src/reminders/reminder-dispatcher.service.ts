import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../email/email.service.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { PushNotificationService } from './push-notification.service.js';

@Injectable()
export class ReminderDispatcherService {
  private readonly logger = new Logger(ReminderDispatcherService.name);
  private readonly frontendUrl: string;

  constructor(
    @Inject(SupabaseService) private readonly supabase: SupabaseService,
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(PushNotificationService) private readonly push: PushNotificationService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.frontendUrl = (config.get<string>('FRONTEND_URL') || 'http://localhost:5173').replace(/\/$/, '');
  }

  async dispatch(userId: string, input: { title: string; message: string; routeId: string; type: string }) {
    const admin = this.supabase.getClient();
    const [{ data: profile }, { data: userResult, error: userError }] = await Promise.all([
      admin.from('profiles').select('first_name,last_name').eq('id', userId).maybeSingle(),
      admin.auth.admin.getUserById(userId),
    ]);
    const recipientName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || 'Viajero/a';
    const link = `${this.frontendUrl}/index.html?trip=${encodeURIComponent(input.routeId)}`;
    const emailAddress = userResult.user?.email;
    const [emailResult, pushResult] = await Promise.allSettled([
      userError || !emailAddress
        ? Promise.resolve({ success: false })
        : this.email.sendTripNotificationEmail({
            toEmail: emailAddress,
            recipientName,
            subject: input.title,
            title: input.title,
            message: input.message,
            actionUrl: link,
          }),
      this.push.sendToUser(userId, {
        title: input.title,
        body: input.message,
        link,
        data: { routeId: input.routeId, type: input.type },
      }),
    ]);
    const emailDelivered = emailResult.status === 'fulfilled' && emailResult.value.success;
    if (!emailDelivered) this.logger.warn(`El correo del recordatorio ${input.type} no fue entregado a ${userId}.`);
    if (pushResult.status === 'rejected') {
      this.logger.warn(`El envío push ${input.type} falló para ${userId}: ${String(pushResult.reason)}`);
    }
    return {
      email: emailDelivered,
      push: pushResult.status === 'fulfilled' ? pushResult.value : { configured: true, attempted: 0, sent: 0 },
    };
  }
}
