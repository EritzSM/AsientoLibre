import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { createTestDatabase, sqlValue } from './postgres-test-harness.mjs';

const fixture = {
  driver: '10000000-0000-4000-8000-000000000001',
  otherDriver: '10000000-0000-4000-8000-000000000002',
  noVehicle: '10000000-0000-4000-8000-000000000003',
  legacyVehicle: '10000000-0000-4000-8000-000000000004',
  passenger: '20000000-0000-4000-8000-000000000001',
  otherPassenger: '20000000-0000-4000-8000-000000000002',
  thirdPassenger: '20000000-0000-4000-8000-000000000003',
};
const missingId = '90000000-0000-4000-8000-000000000009';
let database;

const service = (statement) => `SET ROLE service_role; ${statement}`;
const routeSql = (overrides = {}) => {
  const values = {
    actor: fixture.driver, origin: '  Medellin Centro  ', destination: 'Universidad de Medellin',
    departure: 'now() + interval \'2 days\'', seats: 4, price: 5000, note: '  Salida puntual  ', ...overrides,
  };
  return `SELECT public.create_route(${sqlValue(values.actor)}, ${sqlValue(values.origin)}, ${sqlValue(values.destination)},
    ${values.departure}, ${values.seats}, ${values.price}, ${sqlValue(values.note)});`;
};
const bookingSql = (routeId, actor = fixture.passenger, seats = 1) =>
  `SELECT public.book_route(${sqlValue(actor)}, ${sqlValue(routeId)}, ${seats});`;
const finishSql = (routeId, actor) =>
  `SELECT public.finish_route(${sqlValue(actor)}, ${sqlValue(routeId)});`;
const ratingSql = (routeId, actor, rated, score, comment = null) =>
  `SELECT public.submit_route_rating(${sqlValue(actor)}, ${sqlValue(routeId)}, ${sqlValue(rated)}, ${score}, ${sqlValue(comment)});`;
const removalSql = (routeId, confirmed = false, actor = fixture.driver) =>
  `SELECT public.remove_route(${sqlValue(actor)}, ${sqlValue(routeId)}, ${confirmed});`;
const createRoute = (overrides) => database.json(service(routeSql(overrides)));
const book = (routeId, actor, seats) => database.json(service(bookingSql(routeId, actor, seats)));
const remove = (routeId, confirmed, actor) => database.json(service(removalSql(routeId, confirmed, actor)));
const finish = (routeId, actor) => database.json(service(finishSql(routeId, actor)));
const rate = (routeId, actor, rated, score, comment) => database.json(service(ratingSql(routeId, actor, rated, score, comment)));

before(async () => {
  database = await createTestDatabase();
  const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
  await database.file(path('./bootstrap.sql'));
  await database.file(path('../../supabase/schema.sql'));
  // The base setup is safe to rerun before a versioned migration is applied once.
  await database.file(path('../../supabase/schema.sql'));
  await database.file(path('../../supabase/migrations/202609060001_routes.sql'));
  await database.file(path('../../supabase/migrations/202609120001_route_completion.sql'));
  await database.file(path('../../supabase/migrations/202609120002_cancel_before_departure.sql'));
  await database.file(path('../../supabase/migrations/202609120003_route_ratings.sql'));

  await database.sql(`
    INSERT INTO auth.users (id) VALUES ${Object.values(fixture).map((id) => `(${sqlValue(id)})`).join(',')};
    INSERT INTO public.profiles (id, first_name, last_name, national_id, role) VALUES
      ${Object.entries(fixture).map(([name, id]) => `(${sqlValue(id)},${sqlValue(name)},'Prueba','fixture',${sqlValue(name.toLowerCase().includes('passenger') ? 'pasajero' : 'conductor')})`).join(',')};
    INSERT INTO public.vehicles (user_id,brand,model,color,plate,capacity) VALUES
      (${sqlValue(fixture.driver)},'Mazda','3','Azul','AAA123',4),
      (${sqlValue(fixture.otherDriver)},'Renault','Logan','Gris','BBB123',4),
      (${sqlValue(fixture.legacyVehicle)},'Kia','Rio','Blanco','CCC123',NULL);
  `);
}, { timeout: 240000 });

after(async () => { await database?.close(); }, { timeout: 30000 });

test('creation persists normalized locations, verified driver and available passenger seats', async () => {
  const route = await createRoute({ seats: 3 });
  assert.equal(route.driverId, fixture.driver);
  assert.equal(route.origin, 'Medellin Centro');
  assert.equal(route.destination, 'Universidad de Medellin');
  assert.equal(route.note, 'Salida puntual');
  assert.equal(route.seats, 3);
  assert.equal(route.availableSeats, 3);
  assert.equal(route.status, 'published');
  assert.equal(await database.sql(`SELECT count(*) FROM public.route_catalog WHERE id=${sqlValue(route.id)} AND status='published' AND available_seats=3;`), '1');
});

test('creation rejects incomplete places, invalid seats, past dates and unavailable vehicle capacity', async () => {
  const initialCount = await database.sql('SELECT count(*) FROM public.routes;');
  for (const overrides of [
    { origin: null }, { origin: '   ' }, { destination: '' }, { destination: 'medellin centro' },
    { seats: 0 }, { seats: 5 }, { seats: 'NULL' }, { departure: "now() - interval '1 day'" },
    { departure: "'infinity'::timestamptz" }, { price: -1 }, { price: 1.001 }, { note: 'a'.repeat(501) },
    { actor: fixture.noVehicle }, { actor: fixture.legacyVehicle },
  ]) await database.fails(service(routeSql(overrides)), /VALIDATION_ERROR/);
  for (const actor of [fixture.passenger, missingId]) await database.fails(service(routeSql({ actor })), /FORBIDDEN/);
  assert.equal(await database.sql('SELECT count(*) FROM public.routes;'), initialCount);
});

test('driver can set capacity but cannot reduce it below published seats', async () => {
  const route = await createRoute({ actor: fixture.otherDriver, seats: 4 });
  const update = `SELECT public.save_vehicle(${sqlValue(fixture.otherDriver)},'Renault','Logan','Gris','BBB123',2);`;
  await database.fails(service(update), /CONFLICT/);
  assert.equal(await database.sql(`SELECT capacity FROM public.vehicles WHERE user_id=${sqlValue(fixture.otherDriver)};`), '4');
  await remove(route.id, false, fixture.otherDriver);
  assert.equal((await database.json(service(update))).capacity, 2);
  await database.fails(service(`SELECT public.save_vehicle(${sqlValue(fixture.passenger)},'Renault','Logan','Gris','BBB123',4);`), /FORBIDDEN/);
});

test('delete without passengers withdraws the route and remains idempotent', async () => {
  const route = await createRoute();
  assert.equal((await remove(route.id)).status, 'deleted');
  assert.equal((await remove(route.id)).notifiedPassengers, 0);
  assert.equal(await database.sql(`SELECT count(*) FROM public.route_catalog WHERE id=${sqlValue(route.id)} AND status='published';`), '0');
  await database.fails(service(bookingSql(route.id)), /CONFLICT/);
});

test('another driver and unknown route cannot be removed', async () => {
  const route = await createRoute();
  await database.fails(service(removalSql(route.id, true, fixture.otherDriver)), /FORBIDDEN/);
  await database.fails(service(removalSql(missingId)), /NOT_FOUND/);
  assert.equal(await database.sql(`SELECT status FROM public.routes WHERE id=${sqlValue(route.id)};`), 'published');
});

test('confirmed bookings require cancellation confirmation and remain intact when rejected', async () => {
  const route = await createRoute();
  await book(route.id, fixture.passenger, 2);
  await database.fails(service(removalSql(route.id)), /CANCELLATION_CONFIRMATION_REQUIRED/);
  assert.equal(await database.sql(`SELECT status FROM public.routes WHERE id=${sqlValue(route.id)};`), 'published');
  assert.equal(await database.sql(`SELECT status FROM public.bookings WHERE route_id=${sqlValue(route.id)};`), 'confirmed');
  assert.equal(await database.sql(`SELECT count(*) FROM public.notifications WHERE route_id=${sqlValue(route.id)};`), '0');
});

test('cancellation updates bookings and notifies each passenger exactly once across retries', async () => {
  const route = await createRoute();
  const booking = await book(route.id, fixture.passenger, 2);
  assert.equal((await book(route.id, fixture.passenger, 2)).id, booking.id);
  await book(route.id, fixture.otherPassenger, 1);
  const result = await remove(route.id, true);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.notifiedPassengers, 2);
  assert.equal((await remove(route.id, true)).notifiedPassengers, 2);
  assert.equal(await database.sql(`SELECT count(*) FROM public.bookings WHERE route_id=${sqlValue(route.id)} AND status='cancelled';`), '2');
  const notices = await database.json(`SELECT jsonb_agg(jsonb_build_object('recipient',recipient_id,'message',message)) FROM public.notifications WHERE route_id=${sqlValue(route.id)};`);
  assert.deepEqual(notices.map((notice) => notice.recipient).sort(), [fixture.passenger, fixture.otherPassenger].sort());
  assert(notices.every((notice) => notice.message.includes(route.origin) && notice.message.includes(route.destination)));
});

test('conductor y pasajeros finalizan su participación de forma independiente', async () => {
  const route = await createRoute();
  const booking = await book(route.id, fixture.passenger, 2);
  const driverResult = await finish(route.id, fixture.driver);
  assert.equal(driverResult.role, 'driver');
  assert(driverResult.driverFinishedAt);
  assert.equal(driverResult.passengerFinishedAt, null);
  assert.equal(await database.sql(`SELECT driver_finished_at IS NOT NULL FROM public.routes WHERE id=${sqlValue(route.id)};`), 't');
  assert.equal(await database.sql(`SELECT passenger_finished_at IS NOT NULL FROM public.bookings WHERE id=${sqlValue(booking.id)};`), 'f');

  const passengerResult = await finish(route.id, fixture.passenger);
  assert.equal(passengerResult.role, 'passenger');
  assert(passengerResult.passengerFinishedAt);
  assert.equal(await database.sql(`SELECT passenger_finished_at IS NOT NULL FROM public.bookings WHERE id=${sqlValue(booking.id)};`), 't');
  await database.fails(service(`SELECT public.finish_route(${sqlValue(fixture.otherPassenger)},${sqlValue(route.id)});`), /FORBIDDEN/);
});

test('guarda calificaciones anónimas, impide duplicados y calcula el promedio', async () => {
  const route = await createRoute();
  await book(route.id, fixture.passenger, 2);
  await database.sql(`UPDATE public.routes SET departure_at=now()-interval '1 hour' WHERE id=${sqlValue(route.id)};`);
  await finish(route.id, fixture.driver);
  await finish(route.id, fixture.passenger);
  const first = await rate(route.id, fixture.driver, fixture.passenger, 5, 'Excelente pasajero.');
  assert.equal((await rate(route.id, fixture.driver, fixture.passenger, 1, 'No debe reemplazar.')).id, first.id);
  await rate(route.id, fixture.passenger, fixture.driver, 4);
  assert.equal(await database.sql(`SELECT count(*) FROM public.route_ratings WHERE rated_id=${sqlValue(fixture.passenger)};`), '1');
  assert.equal(await database.sql(`SELECT avg(score) FROM public.route_ratings WHERE rated_id=${sqlValue(fixture.passenger)};`), '5.0000000000000000');
  await database.fails(service(ratingSql(route.id, fixture.otherPassenger, fixture.driver, 5)), /FORBIDDEN/);
});

test('notification write failure rolls back both cancellation and booking changes', async () => {
  const route = await createRoute();
  await book(route.id);
  await database.sql(`
    CREATE FUNCTION public.qa_reject_notice() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'QA_NOTIFICATION_WRITE_FAILED'; END; $$;
    CREATE TRIGGER qa_reject_notice BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.qa_reject_notice();
  `);
  try {
    await database.fails(service(removalSql(route.id, true)), /QA_NOTIFICATION_WRITE_FAILED/);
    assert.equal(await database.sql(`SELECT status FROM public.routes WHERE id=${sqlValue(route.id)};`), 'published');
    assert.equal(await database.sql(`SELECT status FROM public.bookings WHERE route_id=${sqlValue(route.id)};`), 'confirmed');
    assert.equal(await database.sql(`SELECT count(*) FROM public.notifications WHERE route_id=${sqlValue(route.id)};`), '0');
  } finally {
    await database.sql('DROP TRIGGER qa_reject_notice ON public.notifications; DROP FUNCTION public.qa_reject_notice();');
  }
  assert.equal((await remove(route.id, true)).notifiedPassengers, 1);
});

test('only the notification recipient can mark it read and retries retain the original timestamp', async () => {
  const route = await createRoute();
  await book(route.id);
  await remove(route.id, true);
  const id = await database.sql(`SELECT id FROM public.notifications WHERE route_id=${sqlValue(route.id)};`);
  await database.fails(service(`SELECT public.mark_notification_read(${sqlValue(fixture.otherPassenger)},${sqlValue(id)});`), /NOT_FOUND/);
  const mark = service(`SELECT public.mark_notification_read(${sqlValue(fixture.passenger)},${sqlValue(id)});`);
  const first = await database.json(mark);
  assert(first.readAt);
  assert.equal((await database.json(mark)).readAt, first.readAt);
});

test('anonymous and authenticated users cannot bypass the backend using tables, view or privileged RPCs', async () => {
  const route = await createRoute();
  for (const role of ['anon', 'authenticated']) {
    for (const table of ['routes', 'bookings', 'notifications', 'route_catalog']) {
      await database.fails(`SET ROLE ${role}; SELECT * FROM public.${table};`, /permission denied/);
    }
    for (const operation of [routeSql(), bookingSql(route.id), removalSql(route.id, true), `SELECT public.finish_route(${sqlValue(fixture.driver)},${sqlValue(route.id)});`, `SELECT public.route_document(${sqlValue(route.id)});`]) {
      await database.fails(`SET ROLE ${role}; ${operation}`, /permission denied for function/);
    }
  }
  await database.fails(`SET ROLE authenticated; UPDATE public.profiles SET role='conductor' WHERE id=${sqlValue(fixture.passenger)};`, /permission denied/);
  await database.fails(`SET ROLE authenticated; UPDATE public.vehicles SET capacity=8;`, /permission denied/);
});

test('RLS independently blocks row access even if a nonprivileged role accidentally receives table grants', async () => {
  await database.sql(`CREATE ROLE qa_rls_probe NOLOGIN; GRANT USAGE ON SCHEMA public TO qa_rls_probe;
    GRANT SELECT,INSERT ON public.routes,public.bookings,public.notifications TO qa_rls_probe;`);
  for (const table of ['routes', 'bookings', 'notifications']) {
    assert.equal(await database.sql(`SET ROLE qa_rls_probe; SELECT count(*) FROM public.${table};`), '0');
  }
  const vehicle = await database.sql(`SELECT id FROM public.vehicles WHERE user_id=${sqlValue(fixture.driver)};`);
  await database.fails(`SET ROLE qa_rls_probe; INSERT INTO public.routes(driver_id,vehicle_id,origin,destination,departure_at,seats)
    VALUES(${sqlValue(fixture.driver)},${sqlValue(vehicle)},'Centro','Universidad',now()+interval '2 days',1);`, /row-level security policy/);
});

test('concurrent cancellation holds the route lock and prevents a late reservation', async () => {
  const route = await createRoute();
  await book(route.id);
  const cancellation = database.connection('qa_cancel_first');
  const reservation = database.connection('qa_book_after_cancel');
  cancellation.send(`BEGIN; ${service(removalSql(route.id, true))} SELECT 'CANCEL_LOCK_HELD';`);
  await cancellation.waitFor('CANCEL_LOCK_HELD');
  reservation.send(service(bookingSql(route.id, fixture.otherPassenger)));
  await database.waitForLock('qa_book_after_cancel');
  assert.equal((await cancellation.end('COMMIT;')).code, 0);
  const lateBooking = await reservation.end();
  assert.notEqual(lateBooking.code, 0);
  assert.match(lateBooking.errors, /CONFLICT/);
  assert.equal(await database.sql(`SELECT count(*) FROM public.bookings WHERE route_id=${sqlValue(route.id)};`), '1');
  assert.equal(await database.sql(`SELECT count(*) FROM public.notifications WHERE route_id=${sqlValue(route.id)};`), '1');
});

test('reservation committed during deletion forces explicit confirmation without losing a passenger', async () => {
  const route = await createRoute();
  const reservation = database.connection('qa_book_first');
  const deletion = database.connection('qa_delete_after_book');
  reservation.send(`BEGIN; ${service(bookingSql(route.id))} SELECT 'BOOKING_LOCK_HELD';`);
  await reservation.waitFor('BOOKING_LOCK_HELD');
  deletion.send(service(removalSql(route.id)));
  await database.waitForLock('qa_delete_after_book');
  assert.equal((await reservation.end('COMMIT;')).code, 0);
  const result = await deletion.end();
  assert.notEqual(result.code, 0);
  assert.match(result.errors, /CANCELLATION_CONFIRMATION_REQUIRED/);
  assert.equal(await database.sql(`SELECT status FROM public.routes WHERE id=${sqlValue(route.id)};`), 'published');
  assert.equal((await remove(route.id, true)).notifiedPassengers, 1);
});

test('competing reservations cannot sell the final seat twice', async () => {
  const route = await createRoute({ seats: 1 });
  const first = database.connection('qa_first_seat');
  const second = database.connection('qa_second_seat');
  first.send(`BEGIN; ${service(bookingSql(route.id))} SELECT 'SEAT_LOCK_HELD';`);
  await first.waitFor('SEAT_LOCK_HELD');
  second.send(service(bookingSql(route.id, fixture.otherPassenger)));
  await database.waitForLock('qa_second_seat');
  assert.equal((await first.end('COMMIT;')).code, 0);
  const result = await second.end();
  assert.notEqual(result.code, 0);
  assert.match(result.errors, /CONFLICT/);
  assert.equal(await database.sql(`SELECT available_seats FROM public.route_catalog WHERE id=${sqlValue(route.id)};`), '0');
  assert.equal(await database.sql(`SELECT count(*) FROM public.bookings WHERE route_id=${sqlValue(route.id)};`), '1');
});
