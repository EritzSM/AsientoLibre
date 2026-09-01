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
│   │       └── features/
│   │           ├── components/
│   │           │   └── header/          ← Componente Header modular
│   │           │       ├── header.html
│   │           │       ├── header.css
│   │           │       └── header.ts
│   │           │
│   │           └── pages/
│   │               ├── home/            ← Página principal (Home)
│   │               │   ├── home.html
│   │               │   ├── home.css
│   │               │   └── home.ts
│   │               │
│   │               └── auth/            ← Página de Login y Sign-Up
│   │                   ├── auth.html
│   │                   ├── auth.css
│   │                   └── auth.ts
│   │
│   ├── index.html                       ← Entrada página Home (http://localhost:5173/)
│   ├── login.html                       ← Entrada Login/Sign-Up (http://localhost:5173/login.html)
│   └── package.json
│
├── server/                              ← Backend (NestJS + TypeScript)
│   ├── src/
│   │   ├── modules/                     ← Módulos de negocio (Auth, Rides, Users)
│   │   └── main.ts
│   └── package.json
│
├── docker-compose.yml                   ← Base de datos PostgreSQL 16
├── .env.example
└── README.md
```

---

## 🎨 Páginas Implementadas

### 1. **Home (`/` o `/index.html`)**
- Encabezado con logo y navegación.
- Hero interactivo con ilustración de viaje compartido y llamados a la acción.
- Formulario para **Publicar ruta** como conductor (4 asientos).
- Listado en vivo de **Rutas disponibles** con buscador en tiempo real.
- Modal de **Reserva de asientos** (1 o 2 asientos) con confirmación y toast feedback.

### 2. **Login / Sign-Up (`/login.html`)**
- Pestañas dinámicas para alternar entre **Iniciar sesión** y **Registrarse**.
- **Iniciar sesión**: Correo electrónico, Contraseña con botón de visibilidad (mostrar/ocultar) y "¿Olvidaste tu contraseña?".
- **Registrarse**:
  - Nombre y Apellido
  - Documento de identidad (ID / Cédula)
  - Correo electrónico
  - Contraseña y Confirmar contraseña
  - Selector de rol: **Pasajero** o **Conductor**
  - Despliegue de registro de vehículo con carga de documentos (Word y PDF) y opción "Agregar después".
- Auto-login e inicio de sesión persistente.

### 3. **Mi Perfil (`/profile.html`)**
- Visualización de avatar, nombre completo, correo y rol activo.
- Formulario para **modificar datos personales** (Nombre, Apellido, Cédula, Correo, Rol).
- Formulario para **modificar o registrar vehículo** (Marca, Modelo, Color, Placa).
- Formulario para **cambio de contraseña segura**.
- **Zona de Peligro**: Opción para **eliminar cuenta permanentemente** con modal de confirmación y eliminación de datos.

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

### 3. Base de Datos (PostgreSQL Docker)
```bash
docker compose up -d
```