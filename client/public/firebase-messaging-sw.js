self.addEventListener('push', (event) => {
  const payload = event.data?.json() || {};
  const notification = payload.notification || payload.data?.notification || {};
  const data = payload.data || {};
  event.waitUntil(self.registration.showNotification(notification.title || 'Asiento Libre', {
    body: notification.body || data.body || 'Tienes una actualización sobre tu viaje.',
    icon: '/images/logo.png',
    badge: '/images/logo.png',
    data: { link: data.link || '/index.html' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/index.html';
  event.waitUntil(self.clients.openWindow(link));
});
