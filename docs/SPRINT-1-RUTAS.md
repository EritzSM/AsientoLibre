# Historia de usuario: publicación y cancelación de rutas

## Preparación de Supabase

El backend requiere el esquema base y la migración de rutas. En un proyecto nuevo, ejecuta en el SQL Editor, en este orden:

1. `server/supabase/schema.sql`
2. `server/supabase/migrations/202609060001_routes.sql`
3. `server/supabase/migrations/202609090001_email_verification.sql`

En el proyecto Supabase configurado actualmente ya existen `profiles` y `vehicles`; las migraciones versionadas se ejecutan una vez y la migración de correo puede repetirse de forma segura. No copies claves en el frontend ni confirmes una migración si el editor muestra un error.

La migración agrega la capacidad de pasajeros al vehículo, crea rutas, reservas y notificaciones, y define operaciones transaccionales. Los vehículos existentes quedan con capacidad `NULL`; su conductor debe registrarla en **Mi perfil** antes de publicar.

En ejecución normal el backend se conecta por HTTPS con `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_SECRET_KEY`. No necesita la contraseña PostgreSQL. Esa contraseña sólo se requiere para herramientas de conexión directa; la migración puede aplicarse desde el SQL Editor.

## Contrato HTTP

Las operaciones privadas usan `Authorization: Bearer <access_token>`. La identidad y el rol siempre se verifican en Supabase; el cliente no puede indicar el propietario.

- `GET /routes`: rutas futuras publicadas y con cupos. Filtros opcionales: `origin`, `destination`, `date`.
- `POST /routes`: publica `{ origin, destination, date, time, seats, price?, note? }`.
- `GET /routes/mine`: historial de rutas del conductor autenticado.
- `DELETE /routes/:id`: elimina una ruta sin reservas confirmadas.
- `POST /routes/:id/cancel`: exige `{ "confirmed": true }`, cancela reservas y crea avisos persistentes.
- `POST /routes/:id/bookings`: confirma una reserva de `{ seats }` sin sobreventa.
- `GET /routes/bookings/mine`: reservas del usuario autenticado.
- `GET /vehicles/me` y `PUT /vehicles/me`: consulta o registra vehículo y capacidad.
- `GET /notifications` y `PATCH /notifications/:id/read`: bandeja y lectura de avisos.

Las fechas y horas de negocio se interpretan como `America/Bogota`; la base conserva `timestamptz` en UTC.

## Ejecución local

Desde la raíz:

```powershell
npm run setup
npm run dev
```

Frontend: `http://localhost:5173`. Backend: `http://127.0.0.1:3000`. El endpoint `/health` comprueba el proceso y `/health/ready` también verifica que la migración esté aplicada.

## Verificación

```powershell
npm run build
npm run lint
npm test
npm run test:db
```

La suite de base de datos usa un PostgreSQL local desechable y valida bloqueos reales, rollback, control de acceso, cancelaciones idempotentes y ausencia de sobreventa. Consulta `server/test/database/README.md` para sus requisitos.

## Despliegue posterior

`render.yaml` define el backend y el sitio estático. En Render se deben cargar las tres variables de Supabase, `CORS_ORIGINS` con la URL pública del frontend y `VITE_API_URL` con la URL HTTPS del backend. `SUPABASE_SECRET_KEY` pertenece únicamente al servicio backend.
