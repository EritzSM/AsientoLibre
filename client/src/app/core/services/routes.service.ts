import { authService } from './auth.service';

export interface Route {
  id: string;
  driverId: string;
  driverName: string;
  origin: string;
  destination: string;
  date: string;
  time: string;
  seats: number;
  availableSeats: number;
  price: number;
  note: string;
  status: 'published' | 'deleted' | 'cancelled';
  confirmedPassengers: number;
  createdAt: string;
}

export interface CreateRoute {
  origin: string;
  destination: string;
  date: string;
  time: string;
  seats: number;
  price?: number;
  note?: string;
}

export interface RegisteredVehicle {
  id: string;
  brand: string;
  model: string;
  color: string;
  plate: string;
  capacity: number | null;
}

export interface Notification {
  id: string;
  routeId: string;
  type: string;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export interface Booking {
  id: string;
  routeId: string;
  seats: number;
  status: string;
  createdAt: string;
  route: Route;
}

interface ErrorBody {
  message?: string | string[];
  code?: string;
  confirmedPassengers?: number;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  confirmedPassengers: number;

  constructor(status: number, body: ErrorBody) {
    super(Array.isArray(body.message) ? body.message.join(' ') : body.message || 'No se pudo completar la solicitud.');
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.confirmedPassengers = body.confirmedPassengers ?? 0;
  }
}

const API_URL = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

async function request<T>(path: string, options: RequestInit = {}, authenticated = true): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (authenticated) {
    const token = authService.getToken();
    if (!token) throw new ApiError(401, { message: 'Inicia sesión para continuar.' });
    headers.set('Authorization', `Bearer ${token}`);
  }
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch {
    throw new Error('No pudimos conectar con el servidor. Revisa tu conexión e inténtalo nuevamente.');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body ?? {});
  return body as T;
}

export interface RemovalResult {
  message: string;
  status: 'deleted' | 'cancelled';
  notifiedPassengers: number;
}

export const routesService = {
  search(filters: { origin?: string; destination?: string; date?: string } = {}): Promise<Route[]> {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value?.trim()) query.set(key, value.trim()); });
    return request<Route[]>(`/routes?${query}`, {}, false);
  },
  mine: () => request<Route[]>('/routes/mine'),
  bookings: () => request<Booking[]>('/routes/bookings/mine'),
  create: (route: CreateRoute) => request<Route>('/routes', { method: 'POST', body: JSON.stringify(route) }),
  remove: (id: string) => request<RemovalResult>(`/routes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  cancel: (id: string) => request<RemovalResult>(`/routes/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({ confirmed: true }) }),
  reserve: (id: string, seats: number) => request(`/routes/${encodeURIComponent(id)}/bookings`, { method: 'POST', body: JSON.stringify({ seats }) }),
  vehicle: () => request<RegisteredVehicle | null>('/vehicles/me'),
  saveVehicle: (vehicle: Omit<RegisteredVehicle, 'id'>) => request<RegisteredVehicle>('/vehicles/me', { method: 'PUT', body: JSON.stringify(vehicle) }),
  notifications: () => request<Notification[]>('/notifications'),
  markRead: (id: string) => request(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' }),
};
