import { precacheAndRoute } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';

precacheAndRoute(self.__WB_MANIFEST);

// autoUpdate só troca o SW ativo quando não há abas a usar o antigo — sem
// isto, uma aba aberta (ou a própria instalação na tela de início) fica
// presa numa versão publicada há muito tempo. Ativa a versão nova assim
// que chega, mesmo com abas antigas abertas.
self.skipWaiting();
clientsClaim();

self.addEventListener('push', event => {
  let data = { title: 'Agenda Semanal', body: 'Tem uma notificação nova.' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch { /* payload não é JSON — usa o texto */ if (event.data) data.body = event.data.text(); }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'agenda-semanal',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
