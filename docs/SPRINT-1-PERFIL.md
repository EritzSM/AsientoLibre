# Gestión de perfil

La historia permite que un usuario autenticado administre sus datos personales y la seguridad de su cuenta desde `profile.html`.

## Comportamiento implementado

- Actualización de nombre, apellido, documento y teléfono.
- Validación del teléfono: es opcional; si se informa, debe contener entre 7 y 15 dígitos sin espacios ni símbolos.
- Cambio de correo mediante un código temporal enviado al nuevo correo.
- Cambio de contraseña después de comprobar la contraseña actual. Supabase revoca las sesiones y la aplicación solicita iniciar sesión de nuevo.
- Eliminación irreversible de la cuenta después de comprobar la contraseña actual.
- Eliminación en cascada del perfil, vehículo, rutas, reservas y notificaciones asociadas.

El rol se muestra en el formulario, pero no puede modificarse desde el cliente. La identidad y los permisos siempre se obtienen del token autenticado.

## API

Todas las operaciones requieren `Authorization: Bearer <access_token>`.

- `POST /auth/update-profile`: actualiza `firstName`, `lastName`, `nationalId` y `phone`.
- `POST /auth/request-email-change`: envía el código al nuevo correo.
- `POST /auth/confirm-email-change`: confirma el cambio con el código temporal.
- `POST /auth/change-password`: recibe `currentPassword` y `newPassword`.
- `POST /auth/delete-account`: recibe la contraseña actual y elimina al usuario autenticado.

## Base de datos

Ejecuta `server/supabase/migrations/202609200001_profile_management.sql` una vez en el SQL Editor del proyecto existente. La migración agrega el teléfono y las relaciones de eliminación en cascada requeridas por el flujo.

La aplicación se conecta a Supabase mediante su API HTTPS. No necesita la contraseña directa de PostgreSQL.

## Verificación

Las pruebas unitarias comprueban actualización, contraseña actual inválida, cambio de contraseña, cierre global de sesiones y eliminación. Las pruebas de PostgreSQL validan el formato del teléfono y la eliminación en cascada de los datos relacionados.
