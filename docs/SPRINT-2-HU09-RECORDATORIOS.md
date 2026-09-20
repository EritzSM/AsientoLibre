# Sprint 2 — HU-09 Recordatorio de viaje

## Alcance implementado

La solución cubre conductor y pasajero. Cada ruta guarda un punto exacto de encuentro y crea estados de asistencia para el conductor y para cada reserva confirmada.

- A las 24 horas se genera un recordatorio con ruta, fecha, hora y punto de encuentro.
- A 1 hora se genera un aviso urgente que incluye los datos de contacto disponibles de la contraparte.
- El usuario confirma su asistencia desde el banner del inicio; la contraparte recibe un aviso persistente y los canales externos configurados.
- A 30 minutos, el conductor recibe una alerta si existen pasajeros pendientes.
- El sistema sugiere liberar esos cupos. El conductor decide y ejecuta la liberación; no se cancela una reserva automáticamente.
- La vista del conductor muestra el estado de cada pasajero.

## Diseño técnico

`ReminderSchedulerService` se ejecuta cada minuto. La función `claim_due_trip_reminders` crea entregas idempotentes y las reclama con `FOR UPDATE SKIP LOCKED`. Esto permite usar más de una instancia del backend sin duplicar el mismo envío. Los fallos reciben hasta cinco intentos con espera incremental y los trabajos bloqueados se recuperan a los diez minutos.

La notificación interna se persiste antes de llamar a los canales externos. Brevo envía el correo cuando está configurado y usa una simulación local durante desarrollo. Firebase Cloud Messaging es opcional: si faltan sus credenciales, el correo y la notificación interna continúan activos.

Las tablas nuevas tienen RLS y no son accesibles con los roles `anon` o `authenticated`. El backend obtiene el usuario del token y ejecuta las operaciones privilegiadas con la clave secreta de Supabase.

## Migración

Ejecutar en Supabase SQL Editor, después de las migraciones del Sprint 1:

```text
server/supabase/migrations/202609200002_trip_reminders.sql
```

La migración es idempotente. Conserva el campo `driver_finished_at` si las migraciones de la rama ValeRama ya fueron aplicadas y agrega `meeting_point` al catálogo de rutas.

## Configuración push

Backend:

```dotenv
FIREBASE_PROJECT_ID=proyecto-firebase
GOOGLE_APPLICATION_CREDENTIALS=C:/ruta/segura/firebase-service-account.json
```

Frontend:

```dotenv
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_VAPID_KEY=...
```

El archivo JSON de la cuenta de servicio nunca debe guardarse en el repositorio.

## Verificación

```powershell
npm run build
npm run lint
npm test
npm run test:db
```

Las pruebas de PostgreSQL cubren la programación idempotente de 24 horas y 1 hora, la alerta de 30 minutos, la confirmación, la liberación de cupos, RLS y la ejecución repetida de la migración.
