import { RoutesService, presentRoute } from './routes.service.js';
import type { SupabaseService } from '../supabase/supabase.service.js';

describe('consulta de rutas', () => {
  const row = {
    id: 'route', driver_id: 'driver', driver_name: 'Ana Ruiz', origin: 'Bogotá', destination: 'Chía',
    meeting_point: 'Portal norte',
    departure_at: '2099-12-31T02:30:00Z', seats: 4, available_seats: 2, price: 8500, note: null,
    status: 'published', confirmed_passengers: 1, created_at: '2099-01-01T00:00:00Z',
  };

  it('presenta fecha/hora de Colombia aun cuando UTC corresponde al día siguiente', () => {
    expect(presentRoute(row)).toMatchObject({ date: '2099-12-30', time: '21:30', meetingPoint: 'Portal norte', driverName: 'Ana Ruiz', availableSeats: 2, confirmedPassengers: 1 });
  });

  it('solo busca rutas publicadas, futuras y con cupos; fecha usa el día completo de Colombia', async () => {
    const query = { select: vi.fn(), eq: vi.fn(), gt: vi.fn(), ilike: vi.fn(), gte: vi.fn(), lt: vi.fn(), order: vi.fn(), limit: vi.fn() };
    for (const method of Object.values(query)) method.mockReturnValue(query);
    query.limit.mockResolvedValue({ data: [row], error: null });
    const profileQuery = { select: vi.fn(), in: vi.fn().mockResolvedValue({ data: [{ id: 'driver', photo_url: 'https://example.test/photo.jpg' }], error: null }) };
    profileQuery.select.mockReturnValue(profileQuery);
    const from = vi.fn((table: string) => table === 'route_catalog' ? query : profileQuery);
    const service = new RoutesService({ getClient: () => ({ from }) } as unknown as SupabaseService);
    const result = await service.findAvailable({ origin: '100%_centro', destination: 'Chía', date: '2099-12-30' });
    expect(from).toHaveBeenCalledWith('route_catalog');
    expect(query.eq).toHaveBeenCalledWith('status', 'published');
    expect(query.gt).toHaveBeenCalledWith('available_seats', 0);
    expect(query.gt).toHaveBeenCalledWith('departure_at', expect.any(String));
    expect(query.ilike).toHaveBeenCalledWith('origin', '%100\\%\\_centro%');
    expect(query.gte).toHaveBeenCalledWith('departure_at', '2099-12-30T05:00:00.000Z');
    expect(query.lt).toHaveBeenCalledWith('departure_at', '2099-12-31T05:00:00.000Z');
    expect(result).toHaveLength(1);
    expect(result[0].driverPhotoUrl).toBe('https://example.test/photo.jpg');
  });

  it('consulta únicamente el resumen anónimo del perfil autenticado', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { average: 4.5, count: 2 }, error: null });
    const service = new RoutesService({ getClient: () => ({ rpc }) } as unknown as SupabaseService);

    await expect(service.ratingSummary('profile-id')).resolves.toEqual({ average: 4.5, count: 2 });
    expect(rpc).toHaveBeenCalledWith('get_profile_rating_summary', { p_profile: 'profile-id' });
  });

});
