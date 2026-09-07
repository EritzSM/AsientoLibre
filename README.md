# Asiento Libre 🚗

**Asiento Libre** es una plataforma web para compartir viajes y gastos entre conductores y pasajeros, con rutas de ciudad y reservas de hasta 4 asientos.

---

## 🗂️ Arquitectura del Proyecto

```
AsientoLibre/
├── client/                              ← Frontend (Vite + TypeScript + CSS modular)
│   ├── public/
│   │   ├── images/
│   │   │   ├── logo.png                 ← Logo oficial de Asiento Libre
│   │   │   └── hero-car.png             ← Ilustración principal del Hero
│   │   └── favicon.svg
│   │
│   ├── src/
│   │   └── app/
│   │       ├── core/
│   │       │   └── services/
│   │       │       └── auth.service.ts  ← Servicio de autenticación y verificación
│   │       └── features/
│   │           ├── components/
│   │           │   └── header/          ← Componente Header modular
│   │           └── pages/
│   │               ├── home/            ← Página principal (protegida)
│   │               ├── profile/         ← Perfil de usuario (protegida)
│   │               └── auth/            ← Login, Sign-Up y Verificación de correo
│   │
│   ├── index.html                       ← Entrada página Home
│   ├── login.html                       ← Entrada Login/Sign-Up/Verificación
│   └── package.json
│
├── server/                              ← Backend (NestJS + TypeScript)
│   ├── src/
│   │   ├── auth/                        ← Módulo Auth (registro, login, verificación)
│   │   ├── email/                       ← Módulo Email (Brevo REST API, plantillas)
│   │   └── supabase/                    ← Módulo Supabase
│   ├── supabase/
│   │   └── schema.sql                   ← Esquema de base de datos
│   └── package.json
│
└── README.md
```

---

## 🎨 Páginas Implementadas

### 1. **Home (`/` o `/index.html`)** *(protegida)*
- Accesible solo a usuarios con correo verificado.
- Encabezado con logo y navegación.
- Hero interactivo con ilustración de viaje compartido y llamados a la acción.
- Formulario para **Publicar ruta** como conductor (4 asientos).
- Listado en vivo de **Rutas disponibles** con buscador en tiempo real.
- Modal de **Reserva de asientos** (1 o 2 asientos) con confirmación y toast feedback.

### 2. **Login / Sign-Up / Verificación (`/login.html`)**
- Pestañas dinámicas para alternar entre **Iniciar sesión** y **Registrarse**.
- **Registro**: Genera token de activación y envía correo automáticamente con Brevo.
- **Verificación de correo**: Pantalla interactiva con:
  - Reenvío de correo con cooldown de 60 segundos.
  - Cambio de correo si hubo un error tipográfico.
  - Banners de éxito/error según parámetros de URL.
- Los usuarios no verificados no pueden acceder al Home ni al Perfil.

### 3. **Mi Perfil (`/profile.html`)** *(protegida)*
- Accesible solo a usuarios con correo verificado.
- Visualización y edición de datos personales, vehículo y contraseña.

---

## 🚀 Inicio Rápido

### 1. Cliente (Frontend)
```bash
cd client
npm install
npm run dev
```
- Home: **[http://localhost:5173/](http://localhost:5173/)**
- Login / Sign-Up: **[http://localhost:5173/login.html](http://localhost:5173/login.html)**

### 2. Servidor (Backend NestJS)
```bash
cd server
npm install
npm run start:dev
```

### 3. Base de Datos (Supabase)
1. Crea un proyecto en [Supabase](https://supabase.com).
2. Ve al **SQL Editor** y ejecuta el script:
   - [`server/supabase/schema.sql`](server/supabase/schema.sql)
3. Si la tabla `profiles` ya existe (base de datos preexistente), ejecuta la migración:
   ```sql
   ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT false NOT NULL;
   ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS activation_token TEXT;
   ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP WITH TIME ZONE;
   CREATE INDEX IF NOT EXISTS idx_profiles_activation_token ON public.profiles(activation_token);
   ```
4. Copia tus credenciales desde **Project Settings → API**:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` → `SUPABASE_ANON_KEY`
   - `service_role secret` → `SUPABASE_SERVICE_ROLE_KEY`
5. Pega estos valores en `server/.env`.

---

## 📧 Configuración de Brevo (Envío de Correos)

El sistema usa **[Brevo](https://brevo.com)** (anteriormente Sendinblue) para enviar los correos de verificación de cuenta sin requerir dominio personalizado propio.

### ¿Dónde poner las credenciales?
En el archivo **[`server/.env`](server/.env)**:

```env
# Clave API de Brevo (obtenida en app.brevo.com/settings/keys/api)
BREVO_API_KEY=xkeysib-tu_api_key_aqui

# Correo remitente validado en tu cuenta de Brevo:
BREVO_SENDER_EMAIL=esanchez701@soyudemedellin.edu.co

# Nombre del remitente visible para los usuarios:
BREVO_SENDER_NAME=Asiento Libre

# URLs de entorno
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:3000
```

### Pasos para obtener tu API Key en Brevo:
1. Crea tu cuenta gratuita en **[https://brevo.com](https://brevo.com)**.
2. Haz clic en tu nombre/perfil (arriba a la derecha) → **SMTP y API** → Pestaña **Claves API** (o ingresa directo a [https://app.brevo.com/settings/keys/api](https://app.brevo.com/settings/keys/api)).
3. Haz clic en **"Generar una nueva clave API"**, asígnale un nombre (ej. `AsientoLibre`) y cópiala.
4. Pega la clave en `BREVO_API_KEY` en `server/.env`.
5. Asegúrate de que `BREVO_SENDER_EMAIL` coincida con el correo verificado de tu cuenta de Brevo.

> **Sin API Key configurada**: El sistema funciona automáticamente en modo de simulación. El enlace de activación se imprime en la **consola del servidor** (logs de NestJS) para pruebas locales con el bloque `📨 [SIMULACIÓN EMAIL VERIFICACIÓN]`.

---

## 🔐 Flujo de Verificación de Correo

```
Registro → is_active: false → Correo Brevo con enlace de activación (24h)
    ↓
Usuario hace clic en el enlace
    ↓
GET /auth/verify-email?token=...
    ↓
Token válido? → is_active: true → Limpia token → Redirige a /login.html?activated=true
Token inválido/expirado? → Redirige a /login.html?error=expired_token
    ↓
Usuario puede iniciar sesión y acceder a Home y Perfil
```

### Endpoints de verificación:
| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/auth/verify-email?token=...` | Procesa el clic desde el correo → Redirige al frontend |
| `POST` | `/auth/verify-email` | Verificación vía API JSON |
| `POST` | `/auth/resend-verification` | Reenvía el correo de activación |
| `POST` | `/auth/change-unverified-email` | Cambia correo antes de verificar |