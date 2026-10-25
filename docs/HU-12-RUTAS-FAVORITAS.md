# HU-12 — Rutas favoritas

La historia guarda trayectos reutilizables por origen y destino. Una ruta programada sirve como referencia, pero el favorito sigue existiendo aunque ese viaje termine o se elimine.

## Flujo implementado

1. Un pasajero activo marca la estrella en una ruta disponible, una reserva o su historial.
2. El backend guarda un único favorito por pasajero, origen y destino normalizados.
3. La sección **Rutas favoritas** muestra los trayectos guardados y los viajes futuros con cupos para reservar directamente.
4. El pasajero puede desmarcar la estrella o usar **Eliminar de favoritos**.
5. Al publicar un viaje coincidente, el backend crea una notificación interna e intenta enviar correo y push mediante los servicios ya configurados.

## API

- `GET /routes/favorites`: lista los favoritos del pasajero y sus viajes disponibles.
- `POST /routes/favorites/:routeId`: guarda el trayecto de una ruta.
- `DELETE /routes/favorites/:favoriteId`: elimina un favorito del pasajero.

Los tres endpoints requieren autenticación. La base de datos restringe las operaciones a pasajeros activos y bloquea el acceso directo desde los roles cliente.

## Base de datos

Ejecutar `server/supabase/migrations/202610250001_route_favorites.sql` en Supabase SQL Editor. La migración es idempotente y puede repetirse si el editor fue interrumpido.

## Verificación

- Pruebas de base de datos: alta, deduplicación, eliminación, propiedad y permisos.
- Pruebas unitarias: listado con disponibilidad y notificación al publicar una coincidencia.
- Compilación y lint de cliente y servidor.
