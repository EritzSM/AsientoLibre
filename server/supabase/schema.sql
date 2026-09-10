-- ==============================================================================
-- Asiento Libre — Esquema de Base de Datos en Supabase
-- ==============================================================================
-- Ejecuta este script en el SQL Editor de tu panel de Supabase:
-- https://supabase.com/dashboard/project/_/sql/new
-- ==============================================================================

-- 1. Habilitar extensión UUID (por defecto ya suele estar activa en Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Tabla: Perfiles de Usuario (profiles)
-- Vinculada directamente al sistema de autenticación de Supabase (auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    national_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('pasajero', 'conductor')),
    is_active BOOLEAN DEFAULT false NOT NULL,
    activation_token TEXT,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    pending_email TEXT,
    email_change_code TEXT,
    email_change_expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT false NOT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS activation_token TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pending_email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_change_code TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_change_expires_at TIMESTAMP WITH TIME ZONE;

-- 3. Tabla: Vehículos (vehicles)
-- Asociada a los usuarios con rol 'conductor'
CREATE TABLE IF NOT EXISTS public.vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    brand TEXT NOT NULL,
    model TEXT NOT NULL,
    color TEXT NOT NULL,
    plate TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_user_vehicle UNIQUE (user_id)
);

-- 4. Índices para optimizar consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_profiles_national_id ON public.profiles(national_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_activation_token ON public.profiles(activation_token) WHERE activation_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vehicles_user_id ON public.vehicles(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON public.vehicles(plate);

-- 5. Función y Triggers para actualizar 'updated_at' automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_profiles_updated_at ON public.profiles;
CREATE TRIGGER tr_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS tr_vehicles_updated_at ON public.vehicles;
CREATE TRIGGER tr_vehicles_updated_at
    BEFORE UPDATE ON public.vehicles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 6. Configuración de Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

-- El frontend accede a perfiles y vehículos exclusivamente mediante el backend.
-- Esto impide modificar role, is_active o tokens desde una sesión cliente.
DROP POLICY IF EXISTS "Permitir lectura de perfiles a usuarios autenticados" ON public.profiles;
DROP POLICY IF EXISTS "Permitir lectura de perfiles" ON public.profiles;
DROP POLICY IF EXISTS "Permitir inserción de propio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Permitir inserción de perfiles" ON public.profiles;
DROP POLICY IF EXISTS "Permitir actualizar propio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Permitir actualización de perfiles" ON public.profiles;
DROP POLICY IF EXISTS "Permitir lectura de vehículos a usuarios autenticados" ON public.vehicles;
DROP POLICY IF EXISTS "Permitir lectura de vehículos" ON public.vehicles;
DROP POLICY IF EXISTS "Permitir insertar propio vehículo" ON public.vehicles;
DROP POLICY IF EXISTS "Permitir inserción de vehículos" ON public.vehicles;
DROP POLICY IF EXISTS "Permitir actualizar propio vehículo" ON public.vehicles;
DROP POLICY IF EXISTS "Permitir actualización de vehículos" ON public.vehicles;
DROP POLICY IF EXISTS "Permitir eliminar propio vehículo" ON public.vehicles;
DROP POLICY IF EXISTS "Permitir eliminación de vehículos" ON public.vehicles;

REVOKE ALL ON public.profiles, public.vehicles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles, public.vehicles TO service_role;

