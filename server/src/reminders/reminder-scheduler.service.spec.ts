import 'reflect-metadata';
import { ReminderSchedulerService } from './reminder-scheduler.service.js';
import type { SupabaseService } from '../supabase/supabase.service.js';
import type { ReminderDispatcherService } from './reminder-dispatcher.service.js';

describe('scheduler de recordatorios de viaje', () => {
  it('persiste, despacha y completa cada recordatorio reclamado', async () => {
    const delivery = {
      id: '40000000-0000-4000-8000-000000000001',
      route_id: '30000000-0000-4000-8000-000000000001',
      recipient_id: '20000000-0000-4000-8000-000000000001',
      subject_user_id: null,
      kind: '24h',
      origin: 'Medellín',
      destination: 'Campus',
      meeting_point: 'Portería principal',
      departure_at: '2099-01-02T13:00:00.000Z',
      recipient_name: 'Ana Prueba',
      attendance_role: 'passenger',
    };
    const rpc = vi.fn(async (name: string) => name === 'claim_due_trip_reminders'
      ? { data: [delivery], error: null }
      : { data: null, error: null });
    const insert = vi.fn(async () => ({ error: null }));
    const from = vi.fn((table: string) => {
      if (table !== 'notifications') throw new Error(`Tabla inesperada: ${table}`);
      return { insert };
    });
    const dispatch = vi.fn(async () => ({ email: true, push: { configured: false, attempted: 0, sent: 0 } }));
    const service = new ReminderSchedulerService(
      { getClient: () => ({ rpc, from }) } as unknown as SupabaseService,
      { dispatch } as unknown as ReminderDispatcherService,
    );

    await expect(service.processDueReminders(new Date('2099-01-01T13:00:00.000Z')))
      .resolves.toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      route_id: delivery.route_id,
      recipient_id: delivery.recipient_id,
      type: 'trip_reminder_24h',
      metadata: { action: 'confirm_attendance' },
    }));
    expect(dispatch).toHaveBeenCalledWith(delivery.recipient_id, expect.objectContaining({
      routeId: delivery.route_id,
      type: 'trip_reminder_24h',
    }));
    expect(rpc).toHaveBeenLastCalledWith('complete_trip_reminder_delivery', {
      p_delivery: delivery.id,
      p_success: true,
      p_error: null,
    });
  });

  it('deja un envío fallido listo para reintento sin detener el lote', async () => {
    const delivery = {
      id: '40000000-0000-4000-8000-000000000002', route_id: '30000000-0000-4000-8000-000000000002',
      recipient_id: '20000000-0000-4000-8000-000000000002', subject_user_id: null, kind: '24h',
      origin: 'Centro', destination: 'Campus', meeting_point: 'Entrada norte',
      departure_at: '2099-01-02T13:00:00.000Z', recipient_name: 'Luis Prueba', attendance_role: 'driver',
    };
    const rpc = vi.fn(async (name: string) => name === 'claim_due_trip_reminders'
      ? { data: [delivery], error: null }
      : { data: null, error: null });
    const from = vi.fn(() => ({ insert: async () => ({ error: { message: 'write failed' } }) }));
    const service = new ReminderSchedulerService(
      { getClient: () => ({ rpc, from }) } as unknown as SupabaseService,
      { dispatch: vi.fn() } as unknown as ReminderDispatcherService,
    );

    await expect(service.processDueReminders()).resolves.toEqual({ claimed: 1, sent: 0, failed: 1 });
    expect(rpc).toHaveBeenLastCalledWith('complete_trip_reminder_delivery', {
      p_delivery: delivery.id,
      p_success: false,
      p_error: 'write failed',
    });
  });
});
