// 哈寶足球 AI - Service Worker

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// 接收推播
self.addEventListener("push", (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {
      title: "哈寶足球 AI",
      body: event.data ? event.data.text() : "您有一則新通知"
    };
  }

  const title = data.title || "哈寶足球 AI";

  const options = {
    body: data.body || "您有一則新通知",
    icon: "./football_icon_192x192.png",
    badge: "./football_icon_192x192.png",
    data: {
      url: data.url || "./football.html"
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// 點擊通知
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl =
    event.notification.data?.url || "./football.html";

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then((clientList) => {

      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
