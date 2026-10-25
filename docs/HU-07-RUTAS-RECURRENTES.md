# HU-07 — Rutas recurrentes

Una serie recurrente genera rutas normales durante un período fijo de cuatro semanas. Cada instancia conserva el flujo existente de reservas, recordatorios, pagos, favoritos y cancelación.

## Flujos

- El conductor activa **Repetir esta ruta**, selecciona uno o más días y publica.
- El backend genera las fechas coincidentes de los siguientes 28 días en hora de Colombia.
- El calendario mensual permite inspeccionar rutas activas, eliminadas o canceladas.
- Desde un evento del calendario se puede cambiar la hora de toda la serie. Solo cambian instancias futuras sin solicitudes ni reservas.
- Desde el mismo modal se cancela una única instancia mediante el flujo seguro existente; el resto de la serie continúa.
- Los pasajeros que siguen el trayecto como favorito reciben avisos de creación o cambio de horario. Los pasajeros de una instancia cancelada reciben el aviso de cancelación existente.

## API

- `POST /routes/recurring`
- `PATCH /routes/recurring/:seriesId`
- `GET /routes/calendar?from=AAAA-MM-DD&to=AAAA-MM-DD`
- `POST /routes/:id/cancel` para cancelar una instancia.

Ejecutar `server/supabase/migrations/202610260001_recurring_routes.sql` en Supabase SQL Editor antes de iniciar el backend actualizado.
