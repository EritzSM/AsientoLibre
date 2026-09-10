import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SupabaseService } from '../supabase/supabase.service.js';
import { SupabaseAuthGuard } from '../common/supabase-auth.guard.js';
import { RoutesController } from './routes.controller.js';
import { RoutesService } from './routes.service.js';
import { VehiclesController } from '../vehicles/vehicles.controller.js';
import { VehiclesService } from '../vehicles/vehicles.service.js';
import { NotificationsController } from '../notifications/notifications.controller.js';
import { NotificationsService } from '../notifications/notifications.service.js';

const actorId = '20000000-0000-4000-8000-000000000001';
const routeId = '30000000-0000-4000-8000-000000000001';
const routeBody = { origin: 'Bogotá', destination: 'Chía', date: '2099-12-31', time: '14:30', seats: 3, price: 8500, note: 'Punto de encuentro: biblioteca.' };

describe('Rutas: contrato HTTP, autenticación y validación', () => {
  let app: INestApplication;
  const rpc = vi.fn();
  const getUser = vi.fn();
  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: { is_active: true }, error: null }),
      }),
    }),
  }));

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [RoutesController, VehiclesController, NotificationsController],
      providers: [RoutesService, VehiclesService, NotificationsService, SupabaseAuthGuard,
        { provide: SupabaseService, useValue: { getClient: () => ({ auth: { getUser }, rpc, from }) } }],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockImplementation(async (token: string) => token === 'valid-session'
      ? { data: { user: { id: actorId } }, error: null }
      : { data: { user: null }, error: { message: 'Invalid JWT' } });
    rpc.mockResolvedValue({ data: { id: routeId, ...routeBody, status: 'published' }, error: null });
  });

  afterAll(async () => { await app.close(); });

  it('crea una ruta con el actor verificado y convierte la hora de Colombia a UTC', async () => {
    await request(app.getHttpServer()).post('/routes').set('Authorization', 'Bearer valid-session')
      .send({ ...routeBody, origin: '  Bogotá  ' }).expect(201);
    expect(getUser).toHaveBeenCalledWith('valid-session');
    expect(rpc).toHaveBeenCalledWith('create_route', {
      p_actor: actorId, p_origin: 'Bogotá', p_destination: 'Chía', p_departure_at: '2099-12-31T19:30:00.000Z',
      p_seats: 3, p_price: 8500, p_note: routeBody.note,
    });
  });

  it.each([
    ['origen vacío', { origin: '' }], ['origen en blanco', { origin: '   ' }],
    ['destino ausente', { destination: undefined }], ['destino nulo', { destination: null }],
    ['origen igual al destino', { destination: 'bOgOtÁ' }],
    ['fecha imposible', { date: '2099-02-29' }], ['fecha sin formato', { date: '31/12/2099' }],
    ['fecha pasada', { date: '2000-01-01' }], ['hora imposible', { time: '24:00' }],
    ['cero cupos', { seats: 0 }], ['cupos negativos', { seats: -1 }], ['cupos fraccionarios', { seats: 1.5 }],
    ['cupos enviados como texto', { seats: '3' }], ['cupos excesivos', { seats: 9 }],
    ['aporte negativo', { price: -1 }], ['aporte excesivo', { price: 1000001 }], ['aporte con más de dos decimales', { price: 3.555 }],
    ['nota demasiado larga', { note: 'a'.repeat(501) }], ['identidad inyectada', { driverId: 'another-user' }],
  ])('rechaza %s antes de persistir', async (_name, invalid) => {
    await request(app.getHttpServer()).post('/routes').set('Authorization', 'Bearer valid-session')
      .send({ ...routeBody, ...invalid }).expect(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([undefined, 'Basic valid-session', 'Bearer expired', 'Bearer valid-session extra'])('rechaza autenticación inválida: %s', async (authorization) => {
    const call = request(app.getHttpServer()).post('/routes').send(routeBody);
    if (authorization) call.set('Authorization', authorization);
    await call.expect(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['FORBIDDEN', 'Solo un conductor puede publicar rutas.', 403],
    ['VALIDATION_ERROR', 'Registra tu vehículo antes de publicar una ruta.', 400],
    ['VALIDATION_ERROR', 'Completa la capacidad de pasajeros de tu vehículo antes de publicar.', 400],
    ['VALIDATION_ERROR', 'Los cupos deben estar entre 1 y la capacidad de pasajeros del vehículo.', 400],
  ])('propaga la regla de negocio %s (%s)', async (code, message, status) => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: JSON.stringify({ code, message }) } });
    const result = await request(app.getHttpServer()).post('/routes').set('Authorization', 'Bearer valid-session').send(routeBody).expect(status);
    expect(result.body.message).toBe(message);
  });

  it('elimina sin confirmación cuando no hay pasajeros', async () => {
    rpc.mockResolvedValue({ data: { message: 'Ruta eliminada.', status: 'deleted', notifiedPassengers: 0 }, error: null });
    const result = await request(app.getHttpServer()).delete(`/routes/${routeId}`).set('Authorization', 'Bearer valid-session').expect(200);
    expect(result.body).toMatchObject({ status: 'deleted', notifiedPassengers: 0 });
    expect(rpc).toHaveBeenCalledWith('remove_route', { p_actor: actorId, p_route: routeId, p_confirm_cancel: false });
  });

  it('solicita confirmación y entrega el número de pasajeros', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: JSON.stringify({
      code: 'CANCELLATION_CONFIRMATION_REQUIRED', message: 'Confirma la cancelación.', confirmedPassengers: 2,
    }) } });
    const result = await request(app.getHttpServer()).delete(`/routes/${routeId}`).set('Authorization', 'Bearer valid-session').expect(409);
    expect(result.body).toMatchObject({ code: 'CANCELLATION_CONFIRMATION_REQUIRED', confirmedPassengers: 2 });
  });

  it.each([{}, { confirmed: false }, { confirmed: 'true' }, { confirmed: 1 }, { confirmed: true, driverId: actorId }])('rechaza una cancelación sin confirmación estricta: %j', async (body) => {
    await request(app.getHttpServer()).post(`/routes/${routeId}/cancel`).set('Authorization', 'Bearer valid-session').send(body).expect(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('cancela con confirmación explícita y devuelve notificaciones persistidas', async () => {
    rpc.mockResolvedValue({ data: { message: 'Ruta cancelada y pasajeros notificados.', status: 'cancelled', notifiedPassengers: 2 }, error: null });
    const result = await request(app.getHttpServer()).post(`/routes/${routeId}/cancel`).set('Authorization', 'Bearer valid-session')
      .send({ confirmed: true }).expect(200);
    expect(result.body).toMatchObject({ status: 'cancelled', notifiedPassengers: 2 });
    expect(rpc).toHaveBeenCalledWith('remove_route', { p_actor: actorId, p_route: routeId, p_confirm_cancel: true });
  });

  it('valida el identificador de ruta antes de consultar la base de datos', async () => {
    await request(app.getHttpServer()).delete('/routes/invalid').set('Authorization', 'Bearer valid-session').expect(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('requiere autenticación para historial, vehículo, reservas y notificaciones', async () => {
    for (const path of ['/routes/mine', '/vehicles/me', '/routes/bookings/mine', '/notifications']) {
      await request(app.getHttpServer()).get(path).expect(401);
    }
    expect(from).not.toHaveBeenCalled();
  });

  it('reserva usando la identidad verificada del pasajero', async () => {
    await request(app.getHttpServer()).post(`/routes/${routeId}/bookings`).set('Authorization', 'Bearer valid-session').send({ seats: 2 }).expect(201);
    expect(rpc).toHaveBeenCalledWith('book_route', { p_actor: actorId, p_route: routeId, p_seats: 2 });
  });

  it('guarda la capacidad explícita del vehículo y normaliza la placa', async () => {
    await request(app.getHttpServer()).put('/vehicles/me').set('Authorization', 'Bearer valid-session')
      .send({ brand: 'Renault', model: 'Logan', color: 'Gris', plate: 'abc123', capacity: 4 }).expect(200);
    expect(rpc).toHaveBeenCalledWith('save_vehicle', { p_actor: actorId, p_brand: 'Renault', p_model: 'Logan', p_color: 'Gris', p_plate: 'ABC123', p_capacity: 4 });
  });

  it.each([undefined, null, 0, 9, 2.5, '4'])('rechaza capacidad inválida o ausente: %s', async (capacity) => {
    await request(app.getHttpServer()).put('/vehicles/me').set('Authorization', 'Bearer valid-session')
      .send({ brand: 'Renault', model: 'Logan', color: 'Gris', plate: 'ABC123', capacity }).expect(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('marca notificaciones leídas exclusivamente para el destinatario autenticado', async () => {
    await request(app.getHttpServer()).patch(`/notifications/${routeId}/read`).set('Authorization', 'Bearer valid-session').expect(200);
    expect(rpc).toHaveBeenCalledWith('mark_notification_read', { p_actor: actorId, p_notification: routeId });
  });

  it('la búsqueda pública valida fechas imposibles', async () => {
    await request(app.getHttpServer()).get('/routes?date=2099-02-29').expect(400);
    expect(from).not.toHaveBeenCalled();
  });
});
