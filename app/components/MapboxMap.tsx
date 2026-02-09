"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../../lib/firebase";

export type Plot = {
  id: string;
  label: string;
  size: string;
  price: string;
  vendor: string;
  vendorId?: string;
  vendorType: "Company" | "Individual";
  amenities: string[];
  center: [number, number];
  polygon: [number, number][];
  startPoint: [number, number];
  totalParcels?: number;
  availableParcels?: number;
  nodes?: {
    label?: string;
    imageUrl?: string;
  }[];
};
type MapboxMapProps = {
  plots: Plot[];
};

export default function MapboxMap({ plots }: MapboxMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker[]>([]);
  const startMarkerRef = useRef<maplibregl.Marker | null>(null);
  const [is3D, setIs3D] = useState(false);
  const [isSatellite, setIsSatellite] = useState(false);
  const [activePlot, setActivePlot] = useState<Plot | null>(null);
  const [streetViewOpen, setStreetViewOpen] = useState(false);
  const [streetViewStep, setStreetViewStep] = useState(0);
  const [streetViewPrevStep, setStreetViewPrevStep] = useState<number | null>(
    null
  );
  const [streetViewAnimating, setStreetViewAnimating] = useState(false);
  const lastStreetTapRef = useRef(0);
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [inquiryName, setInquiryName] = useState("");
  const [inquiryPhone, setInquiryPhone] = useState("");
  const [inquiryMethod, setInquiryMethod] = useState<
    "Call" | "Text" | "WhatsApp"
  >("WhatsApp");
  const [inquiryMessage, setInquiryMessage] = useState("");
  const [inquirySaving, setInquirySaving] = useState(false);
  const [inquiryError, setInquiryError] = useState<string | null>(null);

  const streetNodes = useMemo(
    () =>
      activePlot?.nodes?.filter((node) => node.imageUrl) ?? [],
    [activePlot]
  );
  const mapTilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  const hasSatellite = Boolean(
    mapTilerKey && mapTilerKey !== "YOUR_MAPTILER_KEY"
  );
  const fallbackStyleUrl =
    "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

  const visiblePlots = useMemo(
    () => (activePlot ? [activePlot] : plots),
    [activePlot, plots]
  );

  const geojson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: visiblePlots.map((plot) => ({
        type: "Feature" as const,
        properties: {
          id: plot.id,
        },
        geometry: {
          type: "Polygon" as const,
          coordinates: [plot.polygon],
        },
      })),
    }),
    [visiblePlots]
  );

  const submitInquiry = async () => {
    if (!activePlot) return;
    if (!inquiryName || !inquiryPhone) {
      setInquiryError("Name and phone are required.");
      return;
    }
    setInquirySaving(true);
    setInquiryError(null);
    try {
      await addDoc(collection(db, "inquiries"), {
        plotId: activePlot.id,
        plotLabel: activePlot.label,
        vendorName: activePlot.vendor,
        vendorType: activePlot.vendorType,
        vendorId: activePlot.vendorId,
        buyerName: inquiryName,
        buyerPhone: inquiryPhone,
        preferredContact: inquiryMethod,
        message: inquiryMessage,
        status: "new",
        createdAt: serverTimestamp(),
      });
      setInquiryOpen(false);
      setInquiryName("");
      setInquiryPhone("");
      setInquiryMessage("");
    } catch {
      setInquiryError("Failed to send inquiry. Try again.");
    } finally {
      setInquirySaving(false);
    }
  };

  useEffect(() => {
    if (streetViewPrevStep === null) return;
    const timer = setTimeout(() => {
      setStreetViewPrevStep(null);
      setStreetViewAnimating(false);
    }, 520);
    return () => clearTimeout(timer);
  }, [streetViewPrevStep, streetViewStep]);

  const goToStreetStep = (nextStep: number) => {
    if (!streetNodes.length) return;
    const bounded = Math.max(0, Math.min(nextStep, streetNodes.length - 1));
    if (bounded === streetViewStep) return;
    setStreetViewPrevStep(streetViewStep);
    setStreetViewStep(bounded);
    setStreetViewAnimating(true);
  };

  const handleStreetAdvance = () => {
    goToStreetStep(streetViewStep + 1);
  };

  const handleStreetTouch = () => {
    const now = Date.now();
    if (now - lastStreetTapRef.current < 300) {
      handleStreetAdvance();
    }
    lastStreetTapRef.current = now;
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const baseStyleUrl = hasSatellite
      ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${mapTilerKey}`
      : fallbackStyleUrl;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: baseStyleUrl,
      center: [36.668, -1.248],
      zoom: 12.6,
      pitch: 0,
      bearing: 0,
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "bottom-right");

    const addPlotLayers = () => {
      if (!map.getSource("plots")) {
        map.addSource("plots", {
          type: "geojson",
          data: geojson,
        });
      }

      if (!map.getLayer("plot-fill")) {
        map.addLayer({
          id: "plot-fill",
          type: "fill",
          source: "plots",
          paint: {
            "fill-color": "#c77d4b",
            "fill-opacity": 0.28,
          },
        });
      }

      if (!map.getLayer("plot-line")) {
        map.addLayer({
          id: "plot-line",
          type: "line",
          source: "plots",
          paint: {
            "line-color": "#1f3d2d",
            "line-width": 2,
          },
        });
      }
    };

    const addMarkers = () => {
      markerRef.current.forEach((marker) => marker.remove());
      markerRef.current = [];
      visiblePlots.forEach((plot) => {
        const marker = document.createElement("div");
        marker.style.background = "rgba(255,255,255,0.92)";
        marker.style.border = "1px solid rgba(234,223,206,0.9)";
        marker.style.borderRadius = "999px";
        marker.style.padding = "6px 10px";
        marker.style.fontSize = "12px";
        marker.style.fontWeight = "600";
        marker.style.color = "#14110f";
        marker.style.boxShadow = "0 8px 16px rgba(20,17,15,0.18)";
        marker.innerText = plot.price;
        marker.style.cursor = "pointer";
        marker.addEventListener("click", () => setActivePlot(plot));
        const mapMarker = new maplibregl.Marker({
          element: marker,
          anchor: "bottom",
        })
          .setLngLat(plot.center)
          .addTo(map);
        markerRef.current.push(mapMarker);
      });
    };

    const handleResize = () => map.resize();
    map.on("load", () => {
      addPlotLayers();
      addMarkers();
      map.resize();
    });

    map.on("style.load", () => {
      addPlotLayers();
    });

    map.on("click", "plot-fill", (event) => {
      const feature = event.features?.[0];
      const id = feature?.properties?.id as string | undefined;
      if (!id) return;
      const plot = plots.find((item) => item.id === id);
      if (plot) {
        setActivePlot(plot);
      }
    });

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      map.remove();
      mapRef.current = null;
    };
  }, [geojson, plots, visiblePlots]);

  useEffect(() => {
    if (!mapRef.current) return;
    const source = mapRef.current.getSource(
      "plots"
    ) as maplibregl.GeoJSONSource | null;
    if (source) {
      source.setData(geojson);
    }

    markerRef.current.forEach((marker) => marker.remove());
    markerRef.current = [];
    visiblePlots.forEach((plot) => {
      const marker = document.createElement("div");
      marker.style.background = "rgba(255,255,255,0.92)";
      marker.style.border = "1px solid rgba(234,223,206,0.9)";
      marker.style.borderRadius = "999px";
      marker.style.padding = "6px 10px";
      marker.style.fontSize = "12px";
      marker.style.fontWeight = "600";
      marker.style.color = "#14110f";
      marker.style.boxShadow = "0 8px 16px rgba(20,17,15,0.18)";
      marker.innerText = plot.price;
      marker.style.cursor = "pointer";
      marker.addEventListener("click", () => setActivePlot(plot));
      const mapMarker = new maplibregl.Marker({
        element: marker,
        anchor: "bottom",
      }).setLngLat(plot.center);
      if (mapRef.current) {
        mapMarker.addTo(mapRef.current);
        markerRef.current.push(mapMarker);
      }
    });
  }, [geojson, plots, visiblePlots]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (startMarkerRef.current) {
      startMarkerRef.current.remove();
      startMarkerRef.current = null;
    }

    if (!activePlot) return;
    const marker = document.createElement("div");
    marker.style.background = "rgba(31,61,45,0.95)";
    marker.style.border = "2px solid #f4f1ea";
    marker.style.borderRadius = "999px";
    marker.style.padding = "6px 10px";
    marker.style.fontSize = "11px";
    marker.style.fontWeight = "700";
    marker.style.color = "#f4f1ea";
    marker.style.boxShadow = "0 10px 18px rgba(20,17,15,0.25)";
    marker.innerText = "Start";
    startMarkerRef.current = new maplibregl.Marker({
      element: marker,
      anchor: "bottom",
    })
      .setLngLat(activePlot.startPoint)
      .addTo(mapRef.current);
  }, [activePlot]);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.easeTo({
      pitch: is3D ? 50 : 0,
      bearing: is3D ? -12 : 0,
      duration: 600,
    });
  }, [is3D]);

  useEffect(() => {
    if (!mapRef.current) return;
    const baseStyleUrl = hasSatellite
      ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${mapTilerKey}`
      : fallbackStyleUrl;
    mapRef.current.setStyle(
      isSatellite && hasSatellite
        ? `https://api.maptiler.com/maps/hybrid/style.json?key=${mapTilerKey}`
        : baseStyleUrl
    );
  }, [hasSatellite, isSatellite, mapTilerKey]);

  return (
    <div className="relative h-[65vh] min-h-[420px] w-full overflow-hidden rounded-[24px] border border-[#eadfce] bg-[#e8dccb] shadow-[0_30px_70px_-45px_rgba(20,17,15,0.55)] sm:min-h-[520px] md:h-[720px] md:rounded-[32px]">
      <div className="absolute left-5 top-5 z-10 flex flex-wrap gap-2 rounded-full bg-white/90 px-3 py-2 text-xs font-semibold text-[#1f3d2d] shadow-sm backdrop-blur">
        <button
          type="button"
          onClick={() => setIs3D((value) => !value)}
          className={`rounded-full px-3 py-1 transition ${
            is3D ? "bg-[#1f3d2d] text-white" : "text-[#1f3d2d]"
          }`}
        >
          {is3D ? "3D view" : "2D view"}
        </button>
        <button
          type="button"
          onClick={() => setIsSatellite((value) => !value)}
          className={`rounded-full px-3 py-1 transition ${
            isSatellite ? "bg-[#c77d4b] text-white" : "text-[#6b3e1e]"
          } ${!hasSatellite ? "cursor-not-allowed opacity-50" : ""}`}
          disabled={!hasSatellite}
        >
          Satellite
        </button>
      </div>
      <div ref={containerRef} className="h-full w-full" />

      {activePlot && (
        <div className="absolute inset-x-3 bottom-3 z-20 w-auto max-h-[70vh] overflow-y-auto rounded-3xl border border-[#eadfce] bg-white/95 p-4 text-xs shadow-[0_20px_60px_-40px_rgba(20,17,15,0.6)] backdrop-blur transition-transform duration-300 ease-out animate-slide-up sm:inset-x-auto sm:bottom-auto sm:right-6 sm:top-6 sm:w-[260px] sm:max-h-none sm:overflow-visible">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.25em] text-[#a67047]">
                {activePlot.id}
              </p>
              <p className="mt-2 text-sm font-semibold text-[#14110f]">
                {activePlot.label}
              </p>
              <p className="mt-1 text-[#5a4a44]">
                {activePlot.size} · {activePlot.price}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setActivePlot(null);
                setInquiryOpen(false);
              }}
              className="rounded-full border border-[#eadfce] px-2 py-1 text-[10px] text-[#5a4a44]"
            >
              Close
            </button>
          </div>
          <div className="mt-3 space-y-2 text-[11px] text-[#3a2f2a]">
            <p>
              Vendor: {activePlot.vendor} · {activePlot.vendorType}
            </p>
            <p>
              Amenities:{" "}
              {activePlot.amenities.length > 0
                ? activePlot.amenities.join(", ")
                : "Not provided"}
            </p>
            {activePlot.totalParcels && activePlot.totalParcels > 1 && (
              <p className="text-[#3a2f2a]">
                Parcels: {activePlot.availableParcels ?? 0} available of{" "}
                {activePlot.totalParcels}
              </p>
            )}
            <p className="text-[#6b3e1e]">
              Start point for the street view is shown on the map. Zoom out if
              you do not see it.
            </p>
          </div>
          {!inquiryOpen ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setStreetViewStep(0);
                  setStreetViewPrevStep(null);
                  setStreetViewAnimating(false);
                  setStreetViewOpen(true);
                }}
                className="mt-4 w-full rounded-full bg-[#1f3d2d] px-3 py-2 text-[11px] font-semibold text-white"
              >
                Open street view
              </button>
              <button
                type="button"
                onClick={() => setInquiryOpen(true)}
                className="mt-2 w-full rounded-full border border-[#1f3d2d]/30 px-3 py-2 text-[11px] font-semibold text-[#1f3d2d]"
              >
                Inquire about property
              </button>
            </>
          ) : (
            <form
              className="mt-4 space-y-3 text-[11px]"
              onSubmit={(event) => {
                event.preventDefault();
                submitInquiry();
              }}
            >
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-[#a67047]">
                  Name
                </label>
                <input
                  type="text"
                  value={inquiryName}
                  onChange={(event) => setInquiryName(event.target.value)}
                  placeholder="Your name"
                  className="mt-2 w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-xs text-[#14110f]"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-[#a67047]">
                  Phone number
                </label>
                <input
                  type="tel"
                  value={inquiryPhone}
                  onChange={(event) => setInquiryPhone(event.target.value)}
                  placeholder="+254 7xx xxx xxx"
                  className="mt-2 w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-xs text-[#14110f]"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-[#a67047]">
                  Preferred contact
                </label>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  {["Call", "Text", "WhatsApp"].map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() =>
                        setInquiryMethod(
                          method as "Call" | "Text" | "WhatsApp"
                        )
                      }
                      className={`rounded-full px-3 py-1 text-[11px] transition ${
                        inquiryMethod === method
                          ? "bg-[#c77d4b] text-white"
                          : "border border-[#eadfce] bg-white text-[#6b3e1e]"
                      }`}
                    >
                      {method}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-[#a67047]">
                  Message
                </label>
                <textarea
                  value={inquiryMessage}
                  onChange={(event) => setInquiryMessage(event.target.value)}
                  rows={3}
                  placeholder="Ask about access, pricing, docs, or timelines."
                  className="mt-2 w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-xs text-[#14110f]"
                />
              </div>
              {inquiryError && (
                <div className="rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-[10px] text-[#b3261e]">
                  {inquiryError}
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setInquiryOpen(false)}
                  className="w-full rounded-full border border-[#eadfce] px-3 py-2 text-[11px] text-[#5a4a44]"
                  disabled={inquirySaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="w-full rounded-full bg-[#1f3d2d] px-3 py-2 text-[11px] font-semibold text-white"
                  disabled={inquirySaving}
                >
                  {inquirySaving ? "Sending..." : "Send inquiry"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {streetViewOpen && activePlot && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-2xl rounded-3xl border border-[#eadfce] bg-[#fbf8f3] p-6 shadow-[0_30px_70px_-40px_rgba(20,17,15,0.6)]">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-[#a67047]">
                  Node-to-node tour
                </p>
                <p className="mt-2 text-lg font-semibold text-[#14110f]">
                  {activePlot.label}
                </p>
                <p className="mt-1 text-xs text-[#5a4a44]">
                  {streetNodes.length > 0
                    ? `Step ${streetViewStep + 1} of ${streetNodes.length}`
                    : "No street view nodes yet"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStreetViewOpen(false)}
                className="rounded-full border border-[#eadfce] px-3 py-1 text-xs text-[#5a4a44]"
              >
                Close
              </button>
            </div>

            <div className="mt-5 overflow-hidden rounded-3xl border border-[#eadfce] bg-[radial-gradient(circle_at_top,_#f4ede2,_#f0e6d7_50%,_#efe1cd)]">
              {streetNodes.length > 0 ? (
                <div className="relative h-[280px]">
                  {streetViewPrevStep !== null && (
                    <div
                      key={`street-prev-${streetViewPrevStep}`}
                      className={`absolute inset-0 bg-cover bg-center transition-opacity duration-300 ease-out ${
                        streetViewAnimating ? "opacity-0" : "opacity-100"
                      } street-swipe-out`}
                      style={{
                        backgroundImage: `url(${streetNodes[streetViewPrevStep]?.imageUrl})`,
                        backgroundSize: "130% 100%",
                        backgroundPosition: "50% 50%",
                      }}
                    />
                  )}
                  <div
                    key={`street-current-${streetViewStep}`}
                    className={`relative h-full w-full bg-cover bg-center transition-all duration-300 ease-out street-swipe-in ${
                      streetViewAnimating
                        ? "scale-[1.02] opacity-90"
                        : "scale-100 opacity-100"
                    }`}
                    style={{
                      backgroundImage: `url(${streetNodes[streetViewStep]?.imageUrl})`,
                      backgroundSize: "130% 100%",
                      backgroundPosition: "50% 50%",
                    }}
                    onDoubleClick={handleStreetAdvance}
                    onTouchEnd={handleStreetTouch}
                    role="button"
                    tabIndex={0}
                    aria-label="Advance to next street view node"
                  />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between px-4 py-3 text-[10px] text-white">
                    <span className="rounded-full bg-black/40 px-2 py-1">
                      Node {streetViewStep + 1} of {streetNodes.length}
                    </span>
                    <span className="rounded-full bg-black/40 px-2 py-1">
                      Double tap to advance
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex h-[280px] items-center justify-center text-sm text-[#6b3e1e]">
                  No street view images available yet.
                </div>
              )}
            </div>

            {streetNodes.length > 0 && (
              <div className="mt-4 flex items-center justify-between text-xs text-[#5a4a44]">
                <p className="text-[#7a6a63]">
                  Double tap the image to move forward.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => goToStreetStep(streetViewStep - 1)}
                    className="rounded-full border border-[#eadfce] px-3 py-1 text-xs text-[#5a4a44]"
                    disabled={streetViewStep === 0}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => goToStreetStep(streetViewStep + 1)}
                    className="rounded-full bg-[#c77d4b] px-3 py-1 text-xs text-white"
                    disabled={streetViewStep >= streetNodes.length - 1}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <style jsx>{`
        .animate-slide-up {
          animation: slideUp 280ms ease-out;
        }
        @keyframes slideUp {
          0% {
            transform: translateY(16px);
            opacity: 0;
          }
          100% {
            transform: translateY(0);
            opacity: 1;
          }
        }
        .street-swipe-in {
          animation: streetSwipeIn 520ms cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        .street-swipe-out {
          animation: streetSwipeOut 520ms cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        @keyframes streetSwipeIn {
          0% {
            opacity: 0;
            transform: translateX(8%) scale(1.2);
            filter: blur(6px);
          }
          60% {
            opacity: 0.95;
            transform: translateX(2%) scale(1.02);
            filter: blur(1.5px);
          }
          100% {
            opacity: 1;
            transform: translateX(0%) scale(1);
            filter: blur(0px);
          }
        }
        @keyframes streetSwipeOut {
          0% {
            opacity: 1;
            transform: translateX(0%) scale(1);
            filter: blur(0px);
          }
          60% {
            opacity: 0.6;
            transform: translateX(-4%) scale(1.08);
            filter: blur(3px);
          }
          100% {
            opacity: 0;
            transform: translateX(-10%) scale(1.12);
            filter: blur(6px);
          }
        }
      `}</style>
    </div>
  );
}
