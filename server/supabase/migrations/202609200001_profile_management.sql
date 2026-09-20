-- Gestión completa de perfil: teléfono y eliminación en cascada de la cuenta.
BEGIN;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_phone_format_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_phone_format_check
  CHECK (phone IS NULL OR phone ~ '^[0-9]{7,15}$');

-- Al borrar auth.users, profiles ya se elimina en cascada. Estas relaciones
-- completan la cascada para rutas, reservas y notificaciones del usuario.
ALTER TABLE public.routes DROP CONSTRAINT IF EXISTS routes_driver_id_fkey;
ALTER TABLE public.routes ADD CONSTRAINT routes_driver_id_fkey
  FOREIGN KEY (driver_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_route_id_fkey;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_route_id_fkey
  FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE CASCADE;

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_passenger_id_fkey;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_passenger_id_fkey
  FOREIGN KEY (passenger_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_route_id_fkey;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_route_id_fkey
  FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE CASCADE;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_recipient_id_fkey;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_recipient_id_fkey
  FOREIGN KEY (recipient_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

COMMIT;
