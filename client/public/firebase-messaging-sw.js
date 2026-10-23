// firebase-messaging-sw.js
// Service Worker para Firebase Cloud Messaging (FCM) y Web Push — Asiento Libre
// Este archivo debe estar en la raíz del dominio (/firebase-messaging-sw.js)

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { notification: { body: event.data ? event.data.text() : '' } };
  }

  const notification = payload.notification || {};
  const data = payload.data || {};

  const title = notification.title || data.title || 'Asiento Libre';
  const body = notification.body || data.body || 'Tienes una nueva actualización.';
  const link = data.link || notification.click_action || '/index.html';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/images/logo.png',
      badge: '/images/logo.png',
      data: { link },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/index.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(self.location.origin));
      if (existing) {
        existing.focus();
        existing.navigate(link);
      } else {
        self.clients.openWindow(link);
      }
    })
  );
});
