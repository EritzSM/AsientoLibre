import { Inject, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import { throwDatabaseError } from '../common/database-error.js';

@Injectable()
export class NotificationsService {
  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

  async findMine(actorId: string) {
    const { data, error } = await this.supabase.getClient().from('notifications')
      .select('id,route_id,type,title,message,read_at,created_at').eq('recipient_id', actorId)
      .order('created_at', { ascending: false }).limit(100);
    if (error) throwDatabaseError(error);
    return data.map((row) => ({ id: row.id, routeId: row.route_id, type: row.type, title: row.title,
      message: row.message, readAt: row.read_at, createdAt: row.created_at }));
  }

  async markRead(actorId: string, notificationId: string) {
    const { data, error } = await this.supabase.getClient().rpc('mark_notification_read', { p_actor: actorId, p_notification: notificationId });
    if (error) throwDatabaseError(error);
    return data;
  }
}
