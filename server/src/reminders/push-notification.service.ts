import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { applicationDefault, getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { SupabaseService } from '../supabase/supabase.service.js';

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);
  private readonly app: App | null;

  constructor(
    @Inject(ConfigService) config: ConfigService,
    @Inject(SupabaseService) private readonly supabase: SupabaseService,
  ) {
    const projectId = config.get<string>('FIREBASE_PROJECT_ID')?.trim();
    if (!projectId) {
      this.app = null;
      this.logger.warn('FCM no configurado. Las notificaciones internas y el correo permanecen activos.');
      return;
    }
    const appName = 'asiento-libre-reminders';
    this.app = getApps().some((candidate) => candidate.name === appName)
      ? getApp(appName)
      : initializeApp({ credential: applicationDefault(), projectId }, appName);
  }

  async sendToUser(userId: string, input: { title: string; body: string; link: string; data?: Record<string, string> }) {
    const { data: rows, error } = await this.supabase.getClient().from('push_tokens')
      .select('token').eq('user_id', userId).order('last_seen_at', { ascending: false }).limit(500);
    if (error) throw new Error(`No se pudieron consultar los destinos push: ${error.message}`);
    const tokens = [...new Set((rows ?? []).map((row) => row.token as string))];
    if (!this.app || !tokens.length) return { configured: Boolean(this.app), attempted: tokens.length, sent: 0 };

    const result = await getMessaging(this.app).sendEachForMulticast({
      tokens,
      notification: { title: input.title, body: input.body },
      data: { ...input.data, link: input.link },
      webpush: { fcmOptions: { link: input.link } },
    });
    const invalidTokens = result.responses.flatMap((response, index) => {
      const code = response.error?.code ?? '';
      return code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')
        ? [tokens[index]] : [];
    });
    if (invalidTokens.length) {
      await this.supabase.getClient().from('push_tokens').delete().in('token', invalidTokens);
    }
    return { configured: true, attempted: tokens.length, sent: result.successCount };
  }
}
