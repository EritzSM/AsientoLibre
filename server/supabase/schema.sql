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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

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

-- Políticas para 'profiles'
-- Lectura: Cualquier usuario autenticado puede ver perfiles (necesario para ver conductores y pasajeros en viajes)
CREATE POLICY "Permitir lectura de perfiles a usuarios autenticados" 
    ON public.profiles FOR SELECT 
    TO authenticated 
    USING (true);

-- Inserción: Permitir a un usuario insertar su propio perfil o al rol de servicio
CREATE POLICY "Permitir inserción de propio perfil" 
    ON public.profiles FOR INSERT 
    WITH CHECK (auth.uid() = id);

-- Actualización: Cada usuario puede actualizar solo su propio perfil
CREATE POLICY "Permitir actualizar propio perfil" 
    ON public.profiles FOR UPDATE 
    USING (auth.uid() = id);

-- Políticas para 'vehicles'
-- Lectura: Cualquier usuario autenticado puede ver datos de vehículos (para ver el auto del viaje)
CREATE POLICY "Permitir lectura de vehículos a usuarios autenticados" 
    ON public.vehicles FOR SELECT 
    TO authenticated 
    USING (true);

-- Inserción: Permitir insertar el vehículo si coincide con su user_id
CREATE POLICY "Permitir insertar propio vehículo" 
    ON public.vehicles FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

-- Actualización: Cada usuario puede actualizar solo su propio vehículo
CREATE POLICY "Permitir actualizar propio vehículo" 
    ON public.vehicles FOR UPDATE 
    USING (auth.uid() = user_id);

-- Borrado: Cada usuario puede eliminar solo su propio vehículo
CREATE POLICY "Permitir eliminar propio vehículo" 
    ON public.vehicles FOR DELETE 
    USING (auth.uid() = user_id);

