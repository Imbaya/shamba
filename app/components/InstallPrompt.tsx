"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const ua = window.navigator.userAgent.toLowerCase();
    const ios =
      /iphone|ipad|ipod/.test(ua) ||
      (ua.includes("mac") && "ontouchend" in document);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    setIsIos(ios);
    setIsStandalone(standalone);

    const handler = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setShowPrompt(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => {
      setShowPrompt(false);
      setDeferredPrompt(null);
    });

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);

  if (isStandalone) return null;

  if (!showPrompt && !isIos) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="w-full max-w-xl rounded-3xl border border-[#eadfce] bg-white/95 p-4 text-xs text-[#3a2f2a] shadow-[0_20px_60px_-40px_rgba(20,17,15,0.55)] backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-[#a67047]">
              Install PlotTrust
            </p>
            {isIos ? (
              <p className="mt-2 text-[11px] text-[#5a4a44]">
                Tap the Share button, then choose “Add to Home Screen”.
              </p>
            ) : (
              <p className="mt-2 text-[11px] text-[#5a4a44]">
                Add PlotTrust to your home screen for a full-screen experience.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowPrompt(false)}
            className="rounded-full border border-[#eadfce] px-3 py-1 text-[10px] text-[#5a4a44]"
          >
            Later
          </button>
        </div>
        {!isIos && deferredPrompt && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={async () => {
                await deferredPrompt.prompt();
                setDeferredPrompt(null);
                setShowPrompt(false);
              }}
              className="rounded-full bg-[#1f3d2d] px-4 py-2 text-xs font-semibold text-white"
            >
              Add to Home Screen
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
