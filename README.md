# Asiento Libre

Aplicación universitaria de car pooling para conectar conductores y pasajeros, publicar rutas, reservar cupos y compartir los costos del viaje.

## Funcionalidad disponible

- Registro e inicio de sesión con perfiles de pasajero y conductor.
- Activación de cuenta mediante enlace enviado por correo.
- Corrección del correo antes de activar la cuenta.
- Edición autenticada de datos personales y cambio de correo mediante código temporal.
- Registro del vehículo y su capacidad de 1 a 8 pasajeros.
- Publicación y búsqueda de rutas futuras.
- Validación de cupos contra la capacidad real del vehículo.
- Reserva de cupos sin sobreventa.
- Eliminación de rutas sin pasajeros confirmados.
- Cancelación confirmada de rutas con reservas y notificaciones persistentes para los pasajeros.

El alcance y las pruebas de la historia de usuario de rutas se describen en [docs/SPRINT-1-RUTAS.md](docs/SPRINT-1-RUTAS.md).

## Tecnologías

- Frontend: Vite, TypeScript, HTML y CSS.
- Backend: NestJS y TypeScript.
- Datos y autenticación: Supabase.
- Pruebas: Vitest, Supertest y PostgreSQL desechable para las reglas de base de datos.

## Configuración

Requiere Node.js 22.12 o superior. Instala todas las dependencias desde la raíz:

```powershell
npm run setup
```

Copia los archivos de ejemplo y completa las credenciales locales:

```powershell
Copy-Item server/.env.example server/.env
Copy-Item client/.env.example client/.env
```

El backend admite las claves actuales `SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_SECRET_KEY`. También conserva compatibilidad con `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`. La clave secreta debe existir solamente en `server/.env`; nunca debe incluirse en el cliente ni en Git.

`BREVO_API_KEY` y `BREVO_SENDER_EMAIL` habilitan el envío real de correos. Sin esas variables, el backend usa el modo local y muestra el enlace o código en su consola.

La contraseña de PostgreSQL no es necesaria para ejecutar la aplicación. El backend usa la API HTTPS de Supabase.

## Base de datos

En el SQL Editor de Supabase, ejecuta los scripts en este orden:

1. `server/supabase/schema.sql`
2. `server/supabase/migrations/202609060001_routes.sql`
3. `server/supabase/migrations/202609090001_email_verification.sql`

Los scripts restringen las escrituras al backend, crean las operaciones transaccionales para rutas y agregan los campos de verificación de correo. La última migración es idempotente y se puede ejecutar sobre el proyecto existente.

## Ejecución local

```powershell
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://127.0.0.1:3000`
- Estado del backend: `http://127.0.0.1:3000/health`
- Estado de Supabase y migraciones: `http://127.0.0.1:3000/health/ready`

## Verificación

```powershell
npm run build
npm run lint
npm test
```

Con Docker Desktop iniciado, ejecuta además las pruebas transaccionales de PostgreSQL:

```powershell
npm run test:db
```

## API principal de rutas

Las operaciones privadas requieren `Authorization: Bearer <access_token>`. El backend obtiene la identidad desde el token y no acepta identificadores de propietario enviados por el cliente.

- `GET /routes`: busca rutas publicadas con filtros opcionales de origen, destino y fecha.
- `POST /routes`: publica origen, destino, fecha, hora, cupos, aporte y nota opcional.
- `GET /routes/mine`: consulta las rutas del conductor autenticado.
- `DELETE /routes/:id`: elimina una ruta sin reservas confirmadas.
- `POST /routes/:id/cancel`: cancela una ruta con confirmación explícita.
- `POST /routes/:id/bookings`: reserva cupos.
- `GET /routes/bookings/mine`: consulta reservas propias.
- `GET /vehicles/me` y `PUT /vehicles/me`: consulta o guarda el vehículo del conductor.
- `GET /notifications` y `PATCH /notifications/:id/read`: consulta y marca avisos como leídos.

Las fechas y horas se interpretan en `America/Bogota` y se guardan en UTC.
