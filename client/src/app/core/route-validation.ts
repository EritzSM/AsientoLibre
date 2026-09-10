import type { CreateRoute } from './services/routes.service';

export type RouteField = keyof CreateRoute;
export type RouteErrors = Partial<Record<RouteField, string>>;

export function colombiaDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (name: string) => parts.find((value) => value.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function validateRoute(route: CreateRoute, capacity: number | null, now = Date.now()): RouteErrors {
  const errors: RouteErrors = {};
  for (const field of ['origin', 'destination'] as const) {
    const value = route[field].trim();
    if (!value) errors[field] = field === 'origin' ? 'Ingresa el origen del viaje.' : 'Ingresa el destino del viaje.';
    else if (value.length < 2 || value.length > 160) errors[field] = 'Escribe entre 2 y 160 caracteres.';
  }
  if (route.origin.trim() && route.origin.trim().toLocaleLowerCase() === route.destination.trim().toLocaleLowerCase()) {
    errors.destination = 'El destino debe ser diferente del origen.';
  }
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(route.date) &&
    !Number.isNaN(Date.parse(`${route.date}T00:00:00Z`)) &&
    new Date(`${route.date}T00:00:00Z`).toISOString().slice(0, 10) === route.date;
  const validTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(route.time);
  if (!validDate) errors.date = 'Selecciona una fecha válida.';
  if (!validTime) errors.time = 'Selecciona una hora válida.';
  if (validDate && validTime && Date.parse(`${route.date}T${route.time}:00-05:00`) <= now) {
    errors.date = 'La salida debe ser futura, según la hora de Colombia.';
  }
  if (!Number.isInteger(capacity) || capacity === null || capacity < 1 || capacity > 8) {
    errors.seats = 'Registra la capacidad de tu vehículo en Mi perfil antes de publicar.';
  } else if (!Number.isInteger(route.seats) || route.seats < 1 || route.seats > capacity) {
    errors.seats = `Ingresa un número entero de cupos entre 1 y ${capacity}.`;
  }
  if (route.price !== undefined && (!Number.isFinite(route.price) || route.price < 0 || route.price > 1000000 || Math.round(route.price * 100) !== route.price * 100)) {
    errors.price = 'Ingresa un aporte entre $0 y $1.000.000 COP, con máximo 2 decimales.';
  }
  if ((route.note?.length ?? 0) > 500) errors.note = 'La nota admite hasta 500 caracteres.';
  return errors;
}
