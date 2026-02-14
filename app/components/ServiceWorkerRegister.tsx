"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    const syncServiceWorker = async () => {
      try {
        if (process.env.NODE_ENV !== "production") {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((registration) => registration.unregister()));
          const cacheNames = await caches.keys();
          await Promise.all(
            cacheNames
              .filter((name) => name.startsWith("plottrust-"))
              .map((name) => caches.delete(name))
          );
          return;
        }
        await navigator.serviceWorker.register("/sw.js");
      } catch {
        // Silent failure: PWA should still work without SW.
      }
    };
    syncServiceWorker();
  }, []);

  return null;
}
