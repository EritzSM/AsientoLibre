import { getApp, getApps, initializeApp } from 'firebase/app';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { authService } from './auth.service';
import { ApiError } from './routes.service';

export type AttendanceStatus = 'pending' | 'confirmed' | 'release_suggested' | 'released' | 'cancelled';

export interface TripParticipant {
  userId: string;
  name: string;
  phone: string;
  role: 'driver' | 'passenger';
  status: AttendanceStatus;
  confirmedAt: string | null;
}

export interface TripReminder {
  routeId: string;
  role: 'driver' | 'passenger';
  status: AttendanceStatus;
  confirmedAt: string | null;
  origin: string;
  destination: string;
  meetingPoint: string;
  startsAt: string;
  minutesUntil: number;
  participants: TripParticipant[];
}

const API_URL = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = authService.getToken();
  if (!token) throw new ApiError(401, { message: 'Inicia sesión para continuar.' });
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body ?? {});
  return body as T;
}

export const remindersService = {
  dashboard: () => request<TripReminder[]>('/reminders'),
  confirm: (routeId: string) => request(`/reminders/routes/${encodeURIComponent(routeId)}/confirm`, { method: 'POST' }),
  attendance: (routeId: string) => request<{ routeId: string; passengers: TripParticipant[] }>(
    `/reminders/routes/${encodeURIComponent(routeId)}/attendance`,
  ),
  release: (routeId: string, passengerId: string) => request(
    `/reminders/routes/${encodeURIComponent(routeId)}/attendance/${encodeURIComponent(passengerId)}/release`,
    { method: 'POST' },
  ),
  savePushToken: (token: string) => request('/reminders/push-token', {
    method: 'PUT', body: JSON.stringify({ token, platform: 'web' }),
  }),
};

export async function enablePushNotifications(onForegroundMessage: () => void): Promise<'enabled' | 'unsupported' | 'unconfigured'> {
  const config = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  if (!config.apiKey || !config.projectId || !config.messagingSenderId || !config.appId || !vapidKey) return 'unconfigured';
  if (!('serviceWorker' in navigator) || !await isSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'unsupported';

  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  const app = getApps().length ? getApp() : initializeApp(config);
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  if (!token) return 'unsupported';
  await remindersService.savePushToken(token);
  onMessage(messaging, () => onForegroundMessage());
  return 'enabled';
}
