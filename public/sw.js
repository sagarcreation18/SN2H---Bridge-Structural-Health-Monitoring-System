// No dashboard/API caching: live measurements must never be served from an old cache.
self.addEventListener("push", (event) => {
  let data = {
    title: "SN²H alert",
    body: "Open the dashboard for current information.",
    url: "/#alerts",
  };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: "/assets/images/sn2h-logo.png",
      data: { url: "/#alerts" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const target = new URL("/#alerts", self.location.origin).href;
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows)
        if (new URL(client.url).origin === self.location.origin) {
          await client.navigate(target);
          return client.focus();
        }
      return self.clients.openWindow(target);
    })(),
  );
});
