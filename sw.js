// HABAO 賽事預測 AI - Service Worker

const CACHE_NAME =
  "habao-static-v6"

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./habao-login-bg-v2.png",
  "./habao-hb-logo.png",
  "./habao-icon-192.png",
  "./habao-icon-512.png",
  "./habao-football-spin.png"
];


/* ========================================
   Install
   預先快取登入頁核心資源
   ======================================== */

self.addEventListener(
  "install",
  (event) => {

    event.waitUntil(
      caches
        .open(CACHE_NAME)
        .then((cache) =>
          cache.addAll(CORE_ASSETS)
        )
    );

    self.skipWaiting();
  }
);


/* ========================================
   Activate
   清除舊版 HABAO Cache
   ======================================== */

self.addEventListener(
  "activate",
  (event) => {

    event.waitUntil(
      Promise.all([
        caches
          .keys()
          .then((keys) =>
            Promise.all(
              keys.map((key) => {

                if (
                  key.startsWith("habao-static-") &&
                  key !== CACHE_NAME
                ) {
                  return caches.delete(key);
                }

                return Promise.resolve();
              })
            )
          ),

        self.clients.claim()
      ])
    );
  }
);


/* ========================================
   Static Asset Cache
   圖片 / manifest：
   Cache First，降低第二次之後載入時間
   ======================================== */

self.addEventListener(
  "fetch",
  (event) => {

    const request = event.request;

    if (request.method !== "GET") {
      return;
    }

    const url =
      new URL(request.url);

    /*
     * Supabase / OAuth / API
     * 絕對不進 Service Worker Cache。
     */
    if (
      url.hostname.includes("supabase.co") ||
      url.hostname.includes("supabase.in") ||
      url.hostname === "cdn.jsdelivr.net"
    ) {
      return;
    }

    /*
     * 只處理本站資源。
     */
    if (
      url.origin !== self.location.origin
    ) {
      return;
    }

    /*
     * HTML 採 Network First，
     * 避免網站更新後一直卡在舊版 index.html。
     */
    if (
      request.mode === "navigate" ||
      url.pathname.endsWith(".html")
    ) {

      event.respondWith(
        fetch(request)
          .then((response) => {

            const copy =
              response.clone();

            caches
              .open(CACHE_NAME)
              .then((cache) =>
                cache.put(
                  request,
                  copy
                )
              );

            return response;
          })
          .catch(() =>
            caches.match(request)
          )
      );

      return;
    }

    /*
     * 圖片 / manifest 等靜態資源
     * Cache First。
     */
    event.respondWith(
      caches
        .match(request)
        .then((cached) => {

          if (cached) {
            return cached;
          }

          return fetch(request)
            .then((response) => {

              if (
                !response ||
                response.status !== 200
              ) {
                return response;
              }

              const copy =
                response.clone();

              caches
                .open(CACHE_NAME)
                .then((cache) =>
                  cache.put(
                    request,
                    copy
                  )
                );

              return response;
            });
        })
    );
  }
);


/* ========================================
   Push Notification
   ======================================== */

self.addEventListener(
  "push",
  (event) => {

    let data = {};

    try {

      data =
        event.data
          ? event.data.json()
          : {};

    } catch (e) {

      data = {
        title:
          "HABAO 賽事預測 AI",

        body:
          event.data
            ? event.data.text()
            : "您有一則新通知"
      };
    }

    const title =
      data.title ||
      "HABAO 賽事預測 AI";

    const options = {

      body:
        data.body ||
        "您有一則新通知",

      icon:
        "./habao-icon-192.png"

      badge:
        "./habao-icon-192.png"

      data: {
        url:
          data.url ||
          "./football.html"
      }
    };

    event.waitUntil(
      self.registration
        .showNotification(
          title,
          options
        )
    );
  }
);


/* ========================================
   Notification Click
   ======================================== */

self.addEventListener(
  "notificationclick",
  (event) => {

    event.notification.close();

    const targetUrl =
      event.notification.data?.url ||
      "./football.html";

    event.waitUntil(
      clients
        .matchAll({
          type: "window",
          includeUncontrolled: true
        })
        .then((clientList) => {

          for (
            const client
            of clientList
          ) {

            if ("focus" in client) {

              client.navigate(
                targetUrl
              );

              return client.focus();
            }
          }

          if (clients.openWindow) {

            return clients.openWindow(
              targetUrl
            );
          }
        })
    );
  }
);
