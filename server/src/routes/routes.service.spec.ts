import { RoutesService, presentRoute } from './routes.service.js';
import type { SupabaseService } from '../supabase/supabase.service.js';
import type { ChangeNotificationService } from '../notifications/change-notification.service.js';

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

  it('notifica a cada pasajero cuando se publica un trayecto favorito', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'new-route' }, error: null });
    const favoriteQuery: any = {};
    favoriteQuery.select = vi.fn().mockReturnValue(favoriteQuery);
    favoriteQuery.eq = vi.fn()
      .mockReturnValueOnce(favoriteQuery)
      .mockResolvedValueOnce({ data: [{ passenger_id: 'passenger-1' }, { passenger_id: 'passenger-1' }], error: null });
    const from = vi.fn().mockReturnValue(favoriteQuery);
    const sendToUser = vi.fn().mockResolvedValue(undefined);
    const service = new RoutesService(
      { getClient: () => ({ rpc, from }) } as unknown as SupabaseService,
      { sendToUser, frontendUrl: 'http://localhost:5173' } as unknown as ChangeNotificationService,
    );

    await service.create('driver-id', {
      origin: 'Bogotá', destination: 'Chía', meetingPoint: 'Portal Norte',
      date: '2099-12-31', time: '14:30', seats: 2, price: 10000,
    });

    expect(sendToUser).toHaveBeenCalledTimes(1);
    expect(sendToUser).toHaveBeenCalledWith('passenger-1', expect.objectContaining({
      routeId: 'new-route', type: 'favorite_route_available',
      metadata: expect.objectContaining({ action: 'reserve_favorite' }),
    }));
  });

  it('lista cada trayecto favorito con sus viajes futuros disponibles', async () => {
    const passengerQuery: any = {};
    passengerQuery.select = vi.fn().mockReturnValue(passengerQuery);
    passengerQuery.eq = vi.fn().mockReturnValue(passengerQuery);
    passengerQuery.maybeSingle = vi.fn().mockResolvedValue({ data: { role: 'pasajero', is_active: true }, error: null });
    const favoritesQuery: any = {};
    favoritesQuery.select = vi.fn().mockReturnValue(favoritesQuery);
    favoritesQuery.eq = vi.fn().mockReturnValue(favoritesQuery);
    favoritesQuery.order = vi.fn().mockReturnValue(favoritesQuery);
    favoritesQuery.limit = vi.fn().mockResolvedValue({ data: [{
      id: 'favorite-1', source_route_id: 'old-route', origin: 'BogotÃ¡', destination: 'ChÃ­a',
      origin_key: row.origin.trim().toLocaleLowerCase('es'),
      destination_key: row.destination.trim().toLocaleLowerCase('es'), created_at: '2099-01-01T00:00:00Z',
    }], error: null });
    const routesQuery: any = {};
    routesQuery.select = vi.fn().mockReturnValue(routesQuery);
    routesQuery.eq = vi.fn().mockReturnValue(routesQuery);
    routesQuery.gt = vi.fn().mockReturnValue(routesQuery);
    routesQuery.order = vi.fn().mockReturnValue(routesQuery);
    routesQuery.limit = vi.fn().mockResolvedValue({ data: [row], error: null });
    const photosQuery: any = {};
    photosQuery.select = vi.fn().mockReturnValue(photosQuery);
    photosQuery.in = vi.fn().mockResolvedValue({ data: [], error: null });
    let profileQueryCount = 0;
    const from = vi.fn((table: string) => {
      if (table === 'route_favorites') return favoritesQuery;
      if (table === 'route_catalog') return routesQuery;
      if (table === 'profiles') return profileQueryCount++ === 0 ? passengerQuery : photosQuery;
      throw new Error(`Tabla inesperada: ${table}`);
    });
    const service = new RoutesService({ getClient: () => ({ from }) } as unknown as SupabaseService);

    await expect(service.favorites('passenger-id')).resolves.toEqual([expect.objectContaining({
      id: 'favorite-1', origin: 'BogotÃ¡', destination: 'ChÃ­a',
      availableRoutes: [expect.objectContaining({ id: 'route' })],
    })]);
  });

});
