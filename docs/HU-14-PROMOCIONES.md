# HU-14 — Ver promociones

## Alcance

- Pasajeros y conductores pueden consultar las promociones activas, su descripción, código (cuando aplica) y vigencia.
- Un pasajero puede elegir una promoción al solicitar cupos. El diálogo muestra subtotal, descuento y total.
- El backend vuelve a validar la vigencia y calcula el descuento dentro de la transacción de reserva. El subtotal, descuento y total quedan guardados con la reserva.
- Al finalizar la ruta, el pago pendiente conserva el total descontado de la reserva.
- El panel de administración permite crear campañas y editar sus datos, vigencia y estado.

## Configuración

Aplicar las migraciones `server/supabase/migrations/202610230001_promotions.sql` y `server/supabase/migrations/202610230002_remove_promotion_conditions.sql` después de las migraciones existentes.

En `/admin.html`, crear una promoción indicando título, descripción, tipo y valor del descuento y vigencia en hora de Colombia. El código es opcional. Las promociones se muestran a pasajeros y conductores cuando están activas y dentro de su periodo de vigencia.

## API

- `GET /routes/promotions`: promociones actualmente vigentes.
- `POST /routes/:id/bookings`: acepta `seats` y, opcionalmente, `promotionId`.
- `GET /admin/promotions`: lista todas las campañas para administración.
- `POST /admin/promotions`: crea una campaña.
- `PUT /admin/promotions/:id`: actualiza una campaña existente.
- `DELETE /admin/promotions/:id`: elimina una campaña; los descuentos ya aplicados a reservas se conservan.
