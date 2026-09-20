# Sprint 2 — HU-04 Gestionar reservas

## Alcance implementado

El pasajero solicita uno o varios cupos desde una ruta disponible. La solicitud se guarda con estado `pending` y se notifica al conductor, pero todavía no reduce los cupos disponibles.

El conductor consulta sus solicitudes pendientes y acepta una desde la página principal. La aceptación comprueba nuevamente la disponibilidad dentro de una transacción, cambia la reserva a `confirmed`, descuenta los cupos y crea notificaciones para pasajero y conductor.

La reserva confirmada se integra con HU-09: al aceptarla se crea automáticamente el estado de asistencia pendiente del pasajero.

## Reglas principales

- Solo un pasajero autenticado puede solicitar cupos.
- Solo el conductor propietario de la ruta puede aceptar la solicitud.
- Una solicitud pendiente no bloquea asientos.
- La aceptación bloquea la ruta y vuelve a calcular los cupos confirmados.
- Dos aceptaciones simultáneas no pueden vender el mismo último cupo.
- Repetir una solicitud idéntica o una aceptación ya completada es idempotente.
- Las solicitudes pendientes se cierran si la ruta es eliminada o cancelada.
- Las funciones privilegiadas no son ejecutables por los roles `anon` o `authenticated`.

## API

- `POST /routes/:routeId/bookings`: registra la solicitud del pasajero.
- `GET /routes/bookings/mine`: muestra solicitudes y reservas del pasajero.
- `GET /routes/booking-requests/mine`: lista solicitudes pendientes del conductor.
- `POST /routes/booking-requests/:bookingId/accept`: confirma la reserva.

## Migración

Ejecutar después de la migración de recordatorios:

```text
server/supabase/migrations/202609200003_booking_management.sql
```

La migración puede ejecutarse nuevamente. Conserva las reservas confirmadas existentes y amplía los estados admitidos por `bookings`.

## Subtareas

1. Modelo y operaciones transaccionales para solicitar y aceptar cupos.
2. API autenticada para crear, listar y aceptar solicitudes.
3. Notificaciones persistentes para conductor y pasajero.
4. Interfaz de solicitud y panel de gestión del conductor.
5. Pruebas de validación, concurrencia, permisos y flujo completo.

## Verificación

```powershell
npm run build
npm run lint
npm test
npm run test:db
```
