"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import {
  type GoogleMapsApi,
  type MapsDirectionsRenderer,
  type MapsMap,
  type MapsPolygon,
  loadGoogleMapsApi,
} from "../../lib/googleMapsLoader";

export type Plot = {
  id: string;
  label: string;
  size: string;
  price: string;
  vendor: string;
  vendorId?: string;
  portalId?: string | null;
  vendorType: "Company" | "Individual";
  amenities: string[];
  center: [number, number];
  polygon?: [number, number][];
  startPoint?: [number, number];
  totalParcels?: number;
  availableParcels?: number;
  isSold?: boolean;
  soldParcelIds?: number[];
  surroundingImages?: {
    name?: string;
    url?: string;
  }[];
  mutationForm?: {
    name?: string;
    url?: string;
  };
  mutationParcels?: {
    parcelNumber: number;
    confidence?: number;
    points: { x: number; y: number }[];
  }[];
  soldParcelOverlays?: {
    parcelNumber: number;
    confidence?: number;
    points: { x: number; y: number }[];
  }[];
  manualParcelOverlays?: {
    parcelNumber: number;
    confidence?: number;
    points: { x: number; y: number }[];
  }[];
};
type MapboxMapProps = {
  plots: Plot[];
  onFiltersClick?: () => void;
};

type OverlayPoint = { x: number; y: number };
type ParcelOverlay = {
  parcelNumber: number;
  confidence?: number;
  points: OverlayPoint[];
};

type EssentialLayerKey =
  | "schools"
  | "hospitals"
  | "roads"
  | "water"
  | "power";

export default function MapboxMap({ plots, onFiltersClick }: MapboxMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapsMap | null>(null);
  const mapsApiRef = useRef<GoogleMapsApi | null>(null);
  const markerRef = useRef<(() => void)[]>([]);
  const polygonRef = useRef<MapsPolygon[]>([]);
  const essentialMarkerRef = useRef<(() => void)[]>([]);
  const hasCenteredToUserRef = useRef(false);
  const directionsRendererRef = useRef<MapsDirectionsRenderer | null>(null);
  const [is3D, setIs3D] = useState(false);
  const [showLandmarks, setShowLandmarks] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [activePlot, setActivePlot] = useState<Plot | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [mutationFormOpen, setMutationFormOpen] = useState(false);
  const [soldOverlays, setSoldOverlays] = useState<ParcelOverlay[]>([]);
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [inquiryName, setInquiryName] = useState("");
  const [inquiryPhone, setInquiryPhone] = useState("");
  const [inquiryMethod, setInquiryMethod] = useState<
    "Call" | "Text" | "WhatsApp"
  >("WhatsApp");
  const [inquiryMessage, setInquiryMessage] = useState("");
  const [inquirySaving, setInquirySaving] = useState(false);
  const [inquiryError, setInquiryError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    { id: string; place_name: string; center: [number, number] }[]
  >([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [distanceQuery, setDistanceQuery] = useState("");
  const [distanceResults, setDistanceResults] = useState<
    { id: string; place_name: string; center: [number, number] }[]
  >([]);
  const [distanceLoading, setDistanceLoading] = useState(false);
  const [distanceError, setDistanceError] = useState<string | null>(null);
  const [distanceTargetName, setDistanceTargetName] = useState<string | null>(
    null
  );
  const [distanceTargetCenter, setDistanceTargetCenter] = useState<
    [number, number] | null
  >(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [routeSummary, setRouteSummary] = useState<{
    distance: string;
    duration: string;
  } | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [essentialEnabled, setEssentialEnabled] = useState<
    Record<EssentialLayerKey, boolean>
  >({
    schools: false,
    hospitals: false,
    roads: false,
    water: false,
    power: false,
  });
  const [favoritePlotIds, setFavoritePlotIds] = useState<string[]>([]);
  const [recentPlotIds, setRecentPlotIds] = useState<string[]>([]);
  const [visitBookingOpen, setVisitBookingOpen] = useState(false);
  const [visitName, setVisitName] = useState("");
  const [visitPhone, setVisitPhone] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [visitNote, setVisitNote] = useState("");
  const [visitSaving, setVisitSaving] = useState(false);
  const [visitError, setVisitError] = useState<string | null>(null);
  const [visitSuccess, setVisitSuccess] = useState<string | null>(null);
  const googleMapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

  const listingImages = useMemo(
    () => activePlot?.surroundingImages?.filter((item) => item.url) ?? [],
    [activePlot]
  );
  const mutationFormIsPdf = useMemo(
    () => {
      const url = activePlot?.mutationForm?.url?.toLowerCase() ?? "";
      return /\.pdf($|\?)/.test(url);
    },
    [activePlot]
  );
  const compactPriceLabel = (value: string) => {
    const normalized = value.trim().toLowerCase();
    const numeric = Number(normalized.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(numeric) || numeric <= 0) return value;
    if (numeric >= 1_000_000) {
      const millions = numeric / 1_000_000;
      const rounded = millions >= 10 ? Math.round(millions) : Math.round(millions * 10) / 10;
      return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}M`;
    }
    if (numeric >= 1_000) {
      return `${Math.round(numeric / 1_000)}k`;
    }
    return `${Math.round(numeric)}`;
  };
  const toRad = (value: number) => (value * Math.PI) / 180;
  const distanceBetweenKm = (a: [number, number], b: [number, number]) => {
    const earthRadiusKm = 6371;
    const dLat = toRad(b[1] - a[1]);
    const dLng = toRad(b[0] - a[0]);
    const lat1 = toRad(a[1]);
    const lat2 = toRad(b[1]);
    const hav =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * earthRadiusKm * Math.asin(Math.sqrt(hav));
  };
  const formatDistance = (km: number) =>
    km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km >= 10 ? 1 : 2)} km`;
  const visiblePlots = useMemo(
    () => (activePlot ? [activePlot] : plots),
    [activePlot, plots]
  );
  const favoritePlots = useMemo(
    () =>
      favoritePlotIds
        .map((id) => plots.find((plot) => plot.id === id))
        .filter((plot): plot is Plot => Boolean(plot)),
    [favoritePlotIds, plots]
  );
  const recentPlots = useMemo(
    () =>
      recentPlotIds
        .map((id) => plots.find((plot) => plot.id === id))
        .filter((plot): plot is Plot => Boolean(plot))
        .slice(0, 6),
    [plots, recentPlotIds]
  );
  const essentialLayerConfig = useMemo<
    Record<EssentialLayerKey, { label: string; keyword: string; color: string }>
  >(
    () => ({
      schools: { label: "Schools", keyword: "school", color: "#1f77b4" },
      hospitals: { label: "Hospitals", keyword: "hospital", color: "#d62728" },
      roads: { label: "Road points", keyword: "road junction", color: "#8c564b" },
      water: { label: "Water points", keyword: "water point", color: "#17becf" },
      power: { label: "Power points", keyword: "power station", color: "#ff7f0e" },
    }),
    []
  );

  const runSearch = async () => {
    const trimmed = searchQuery.trim();
    if (!trimmed) return;
    setSearchLoading(true);
    setSearchError(null);
    try {
      const response = await fetch(`/api/google-geocode?q=${encodeURIComponent(trimmed)}`);
      if (!response.ok) {
        throw new Error("Search failed");
      }
      const data = (await response.json()) as {
        results?: { id: string; place_name: string; center: [number, number] }[];
      };
      setSearchResults(data.results ?? []);
    } catch {
      setSearchError("Search failed. Try again.");
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };
  const runDistanceSearch = async () => {
    const trimmed = distanceQuery.trim();
    if (!trimmed) return;
    setDistanceLoading(true);
    setDistanceError(null);
    try {
      const response = await fetch(`/api/google-geocode?q=${encodeURIComponent(trimmed)}`);
      if (!response.ok) {
        throw new Error("Search failed");
      }
      const data = (await response.json()) as {
        results?: { id: string; place_name: string; center: [number, number] }[];
      };
      setDistanceResults(data.results ?? []);
      if ((data.results ?? []).length === 0) {
        setDistanceError("No matching location found.");
      }
    } catch {
      setDistanceError("Search failed. Try again.");
      setDistanceResults([]);
    } finally {
      setDistanceLoading(false);
    }
  };

  const drawRouteToPlot = async (
    originCenter: [number, number],
    plotCenter: [number, number]
  ) => {
    const maps = mapsApiRef.current;
    const map = mapRef.current;
    if (!maps || !map || !maps.DirectionsService || !maps.DirectionsRenderer) {
      setDistanceError("Routing is not available on this map.");
      return;
    }
    setRouteLoading(true);
    try {
      const service = new maps.DirectionsService();
      const result = await service.route({
        origin: { lat: originCenter[1], lng: originCenter[0] },
        destination: { lat: plotCenter[1], lng: plotCenter[0] },
        travelMode: maps.TravelMode?.DRIVING ?? "DRIVING",
      });
      if (!directionsRendererRef.current) {
        directionsRendererRef.current = new maps.DirectionsRenderer({
          map,
          suppressMarkers: false,
          polylineOptions: {
            strokeColor: "#1f3d2d",
            strokeOpacity: 0.92,
            strokeWeight: 5,
          },
        });
      } else {
        directionsRendererRef.current.setMap(map);
      }
      directionsRendererRef.current.setDirections(result);
      const leg = result.routes?.[0]?.legs?.[0];
      setRouteSummary({
        distance: leg?.distance?.text || "N/A",
        duration: leg?.duration?.text || "N/A",
      });
    } catch {
      setDistanceError("Failed to load route. Try another location.");
      setRouteSummary(null);
    } finally {
      setRouteLoading(false);
    }
  };

  const submitVisitBooking = async () => {
    if (!activePlot) return;
    if (!visitName.trim() || !visitPhone.trim() || !visitDate) {
      setVisitError("Name, phone and visit date/time are required.");
      return;
    }
    setVisitSaving(true);
    setVisitError(null);
    setVisitSuccess(null);
    try {
      await addDoc(collection(db, "visitBookings"), {
        plotId: activePlot.id,
        plotLabel: activePlot.label,
        vendorName: activePlot.vendor,
        vendorId: activePlot.vendorId ?? null,
        portalId: activePlot.portalId ?? null,
        requestedByName: visitName.trim(),
        requestedByPhone: visitPhone.trim(),
        preferredVisitAt: visitDate,
        note: visitNote.trim(),
        status: "requested",
        createdAt: serverTimestamp(),
      });
      setVisitSuccess("Visit request submitted.");
      setVisitBookingOpen(false);
      setVisitName("");
      setVisitPhone("");
      setVisitDate("");
      setVisitNote("");
    } catch {
      setVisitError("Failed to submit visit request. Try again.");
    } finally {
      setVisitSaving(false);
    }
  };

  const submitInquiry = async () => {
    if (!activePlot) return;
    if (!inquiryName || !inquiryPhone) {
      setInquiryError("Name and phone are required.");
      return;
    }
    setInquirySaving(true);
    setInquiryError(null);
    try {
      let assignedAgentId = "";
      let assignedAgentName = "";
      if (activePlot.portalId) {
        try {
          const portalSnap = await getDocs(
            query(
              collection(db, "vendorPortals"),
              where("__name__", "==", activePlot.portalId)
            )
          );
          if (!portalSnap.empty) {
            const portal = portalSnap.docs[0].data() as {
              members?: Record<
                string,
                { role?: string; name?: string; email?: string }
              >;
            };
            const agents = Object.entries(portal.members ?? {})
              .filter(([, member]) => member?.role === "agent")
              .map(([id, member]) => ({
                id,
                name: member?.name || member?.email || "Agent",
              }));
            if (agents.length) {
              const inquiriesSnap = await getDocs(
                query(
                  collection(db, "inquiries"),
                  where("portalId", "==", activePlot.portalId)
                )
              );
              const assignmentCounts = new Map<string, number>(
                agents.map((agent) => [agent.id, 0])
              );
              inquiriesSnap.forEach((docSnap) => {
                const data = docSnap.data() as {
                  status?: "new" | "responded";
                  assignedAgentId?: string;
                };
                if (data.status === "responded") return;
                if (!data.assignedAgentId) return;
                if (!assignmentCounts.has(data.assignedAgentId)) return;
                assignmentCounts.set(
                  data.assignedAgentId,
                  (assignmentCounts.get(data.assignedAgentId) ?? 0) + 1
                );
              });
              const minimumLoad = Math.min(
                ...Array.from(assignmentCounts.values())
              );
              const eligibleAgents = agents.filter(
                (agent) =>
                  (assignmentCounts.get(agent.id) ?? 0) === minimumLoad
              );
              const selected =
                eligibleAgents[
                  Math.floor(Math.random() * eligibleAgents.length)
                ];
              assignedAgentId = selected.id;
              assignedAgentName = selected.name;
            }
          }
        } catch {
          // Fallback assignment is handled from the vendor dashboard if needed.
        }
      }
      await addDoc(collection(db, "inquiries"), {
        plotId: activePlot.id,
        plotLabel: activePlot.label,
        vendorName: activePlot.vendor,
        vendorType: activePlot.vendorType,
        vendorId: activePlot.vendorId,
        portalId: activePlot.portalId ?? null,
        assignedAgentId,
        assignedAgentName,
        ...(assignedAgentId ? { assignedAt: serverTimestamp() } : {}),
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
    setDistanceResults([]);
    setDistanceError(null);
    setDistanceTargetName(null);
    setDistanceTargetCenter(null);
    setDistanceKm(null);
    setRouteSummary(null);
    directionsRendererRef.current?.setMap(null);
    directionsRendererRef.current = null;
    setVisitBookingOpen(false);
    setVisitError(null);
    setVisitSuccess(null);
  }, [activePlot?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const rawFavorites = window.localStorage.getItem("favoritePlotIds");
      const rawRecent = window.localStorage.getItem("recentPlotIds");
      if (rawFavorites) {
        const parsed = JSON.parse(rawFavorites) as string[];
        if (Array.isArray(parsed)) setFavoritePlotIds(parsed);
      }
      if (rawRecent) {
        const parsed = JSON.parse(rawRecent) as string[];
        if (Array.isArray(parsed)) setRecentPlotIds(parsed);
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  useEffect(() => {
    if (!activePlot) return;
    setRecentPlotIds((current) => {
      const next = [activePlot.id, ...current.filter((id) => id !== activePlot.id)].slice(
        0,
        8
      );
      if (typeof window !== "undefined") {
        window.localStorage.setItem("recentPlotIds", JSON.stringify(next));
      }
      return next;
    });
  }, [activePlot]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("favoritePlotIds", JSON.stringify(favoritePlotIds));
  }, [favoritePlotIds]);

  useEffect(() => {
    if (!activePlot || !mutationFormOpen) {
      setSoldOverlays([]);
      return;
    }
    const soldSet = new Set(activePlot.soldParcelIds ?? []);
    if (!soldSet.size) {
      setSoldOverlays([]);
      return;
    }
    const source =
      activePlot.soldParcelOverlays?.length
        ? activePlot.soldParcelOverlays
        : activePlot.mutationParcels?.length
        ? activePlot.mutationParcels
        : activePlot.manualParcelOverlays ?? [];
    setSoldOverlays(
      source.filter(
        (overlay) =>
          soldSet.has(overlay.parcelNumber) && (overlay.points?.length ?? 0) >= 3
      )
    );
  }, [activePlot, mutationFormOpen]);

  useEffect(() => {
    let cancelled = false;
    const refreshSoldOverlays = async () => {
      if (!activePlot || !mutationFormOpen) return;
      if (!activePlot.mutationForm?.url) return;
      if (/\.pdf($|\?)/i.test(activePlot.mutationForm.url)) return;
      const soldParcelIds = activePlot.soldParcelIds ?? [];
      if (!soldParcelIds.length) return;
      const existing = activePlot.soldParcelOverlays ?? [];
      const hasAll = soldParcelIds.every((id) =>
        existing.some((overlay) => overlay.parcelNumber === id)
      );
      if (hasAll) return;
      try {
        const response = await fetch("/api/mutation-overlay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mutationFormUrl: activePlot.mutationForm.url,
            soldParcelIds,
          }),
        });
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as {
          overlays?: ParcelOverlay[];
        };
        const fetched = (payload.overlays ?? []).filter(
          (overlay) =>
            soldParcelIds.includes(overlay.parcelNumber) &&
            overlay.points.length >= 3
        );
        if (!fetched.length || cancelled) return;
        let mergedForState: ParcelOverlay[] = [];
        setSoldOverlays((current) => {
          const map = new Map<number, ParcelOverlay>();
          current.forEach((overlay) => map.set(overlay.parcelNumber, overlay));
          fetched.forEach((overlay) => map.set(overlay.parcelNumber, overlay));
          mergedForState = Array.from(map.values()).sort(
            (a, b) => a.parcelNumber - b.parcelNumber
          );
          return mergedForState;
        });
        if (!cancelled && mergedForState.length) {
          setActivePlot((current) =>
            current
              ? {
                  ...current,
                  soldParcelOverlays: mergedForState,
                }
              : current
          );
        }
      } catch {
        // keep existing overlay state on refresh failures
      }
    };
    refreshSoldOverlays();
    return () => {
      cancelled = true;
    };
  }, [activePlot, mutationFormOpen]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let cancelled = false;
    loadGoogleMapsApi()
      .then((maps) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        mapsApiRef.current = maps;
        mapRef.current = new maps.Map(containerRef.current, {
          center: { lat: -1.248, lng: 36.668 },
          zoom: 12.6,
          mapId: googleMapId,
          mapTypeId: "hybrid",
          tilt: 0,
          heading: 0,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: true,
          gestureHandling: "greedy",
          scrollwheel: true,
        });
        setMapReady(true);
      })
      .catch(() => {
        setSearchError("Google Maps failed to load.");
      });

    return () => {
      cancelled = true;
      markerRef.current.forEach((clear) => clear());
      markerRef.current = [];
      polygonRef.current.forEach((polygon) => polygon.setMap(null));
      polygonRef.current = [];
      essentialMarkerRef.current.forEach((clear) => clear());
      essentialMarkerRef.current = [];
      directionsRendererRef.current?.setMap(null);
      directionsRendererRef.current = null;
      mapRef.current = null;
      setMapReady(false);
    };
  }, [googleMapId]);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setMapTypeId?.(showLandmarks ? "hybrid" : "satellite");
  }, [showLandmarks]);

  useEffect(() => {
    if (!mapReady || hasCenteredToUserRef.current) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      hasCenteredToUserRef.current = true;
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!mapRef.current || hasCenteredToUserRef.current) return;
        mapRef.current.setCenter({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        mapRef.current.setZoom(13);
        hasCenteredToUserRef.current = true;
      },
      () => {
        hasCenteredToUserRef.current = true;
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  }, [mapReady]);

  useEffect(() => {
    const maps = mapsApiRef.current;
    const map = mapRef.current;
    if (!maps || !map) return;

    essentialMarkerRef.current.forEach((clear) => clear());
    essentialMarkerRef.current = [];

    const plot = activePlot;
    if (!plot) return;

    const enabled = (Object.keys(essentialEnabled) as EssentialLayerKey[]).filter(
      (key) => essentialEnabled[key]
    );
    if (!enabled.length) return;
    if (!maps.places?.PlacesService) return;

    const service = new maps.places.PlacesService(map);
    enabled.forEach((key) => {
      const layer = essentialLayerConfig[key];
      service.nearbySearch(
        {
          location: { lat: plot.center[1], lng: plot.center[0] },
          radius: 5000,
          keyword: layer.keyword,
        },
        (results, status) => {
          if (!results || !results.length) return;
          const okStatus = maps.places?.PlacesServiceStatus?.OK ?? "OK";
          if (status !== okStatus) return;
          results.slice(0, 8).forEach((item) => {
            const lat = item.geometry?.location?.lat();
            const lng = item.geometry?.location?.lng();
            if (typeof lat !== "number" || typeof lng !== "number") return;
            const marker = new maps.Marker({
              map,
              position: { lat, lng },
              title: `${item.name || layer.label}${item.vicinity ? ` - ${item.vicinity}` : ""}`,
              label: {
                text: layer.label.charAt(0),
                color: "#ffffff",
                fontSize: "10px",
                fontWeight: "700",
              },
              icon: {
                path: maps.SymbolPath.CIRCLE,
                scale: 8,
                fillColor: layer.color,
                fillOpacity: 0.95,
                strokeColor: "#ffffff",
                strokeWeight: 1.5,
              } as unknown,
            });
            essentialMarkerRef.current.push(() => marker.setMap(null));
          });
        }
      );
    });
  }, [activePlot, essentialEnabled, essentialLayerConfig]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = mapsApiRef.current;
    if (!map || !maps) return;

    markerRef.current.forEach((clear) => clear());
    markerRef.current = [];
    polygonRef.current.forEach((polygon) => {
      maps.event.clearInstanceListeners(polygon);
      polygon.setMap(null);
    });
    polygonRef.current = [];

    visiblePlots.forEach((plot) => {
      const position = { lat: plot.center[1], lng: plot.center[0] };
      const compactPrice = compactPriceLabel(plot.price);
      if (maps.marker?.AdvancedMarkerElement) {
        const card = document.createElement("button");
        card.type = "button";
        card.textContent = compactPrice;
        card.style.background = "rgba(255,255,255,0.98)";
        card.style.border = "1px solid rgba(234,223,206,0.95)";
        card.style.borderRadius = "999px";
        card.style.padding = "7px 11px";
        card.style.fontSize = "13px";
        card.style.fontWeight = "700";
        card.style.fontFamily = "\"Poppins\", \"Inter\", \"Segoe UI\", Arial, sans-serif";
        card.style.letterSpacing = "0.01em";
        card.style.color = plot.isSold ? "#6b6058" : "#14110f";
        card.style.boxShadow = "0 8px 16px rgba(20,17,15,0.18)";
        card.style.cursor = "pointer";
        card.style.whiteSpace = "nowrap";
        card.addEventListener("click", () => setActivePlot(plot));

        const marker = new maps.marker.AdvancedMarkerElement({
          map,
          position,
          content: card,
          title: `${plot.label} ${plot.price}`,
          gmpClickable: true,
        });
        markerRef.current.push(() => {
          marker.map = null;
          card.remove();
        });
      } else {
        const marker = new maps.Marker({
          map,
          position,
          label: {
            text: compactPrice,
            color: plot.isSold ? "#5c524c" : "#101010",
            fontSize: "13px",
            fontWeight: "700",
          },
        });
        maps.event.addListener(marker, "click", () => setActivePlot(plot));
        markerRef.current.push(() => marker.setMap(null));
      }

      if ((plot.polygon?.length ?? 0) < 3) return;
      const paths = (plot.polygon ?? []).map(([lng, lat]) => ({ lat, lng }));
      const polygon = new maps.Polygon({
        map,
        paths,
        strokeColor: plot.isSold ? "#9a8f87" : "#1f3d2d",
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: plot.isSold ? "#d9d0c7" : "#c77d4b",
        fillOpacity: 0.28,
        clickable: true,
      });
      maps.event.addListener(polygon, "click", () => setActivePlot(plot));
      polygonRef.current.push(polygon);
    });
  }, [plots, visiblePlots, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = mapsApiRef.current;
    if (!map || !maps) return;
    if (!activePlot) return;
    const availablePlots = visiblePlots.filter((plot) => !plot.isSold);
    if (!availablePlots.length) return;
    const bounds = new maps.LatLngBounds();
    availablePlots.forEach((plot) => {
      if ((plot.polygon?.length ?? 0) >= 3) {
        plot.polygon?.forEach(([lng, lat]) => bounds.extend({ lat, lng }));
      } else {
        bounds.extend({ lat: plot.center[1], lng: plot.center[0] });
      }
    });
    map.fitBounds(bounds, 60);
  }, [activePlot, visiblePlots, mapReady]);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setTilt?.(is3D ? 45 : 0);
    mapRef.current.setHeading?.(is3D ? -12 : 0);
  }, [is3D]);

  return (
    <div className="relative h-[55vh] min-h-[360px] w-full overflow-hidden rounded-[20px] border border-[#284675] bg-[#08152f] shadow-[0_35px_80px_-50px_rgba(0,0,0,0.9)] sm:h-[65vh] sm:min-h-[520px] md:h-[720px] md:rounded-[32px]">
      <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-2 rounded-full border border-[#284675] bg-[#08152f]/85 px-2 py-2 text-[10px] font-semibold text-[#d6e5ff] shadow-sm backdrop-blur sm:left-5 sm:top-5 sm:px-3 sm:py-2 sm:text-xs">
        <button
          type="button"
          onClick={() => setShowLandmarks((value) => !value)}
          className={`rounded-full px-3 py-1 transition ${
            showLandmarks ? "bg-[#d1a741] text-[#091631]" : "text-[#d6e5ff]"
          }`}
        >
          {showLandmarks ? "Landmarks on" : "Landmarks off"}
        </button>
        <button
          type="button"
          onClick={() => setIs3D((value) => !value)}
          className={`rounded-full px-3 py-1 transition ${
            is3D ? "bg-[#2454a0] text-white" : "text-[#d6e5ff]"
          }`}
        >
          {is3D ? "3D view" : "2D view"}
        </button>
      </div>
      <div className="absolute right-3 top-3 z-10 w-[180px] rounded-2xl border border-[#284675] bg-[#08152f]/88 p-2 text-[10px] shadow-sm backdrop-blur sm:right-5 sm:top-5 sm:w-[240px] sm:text-[11px]">
        <div
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
          suppressHydrationWarning
        >
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                runSearch();
              }
            }}
            placeholder="Search places"
            className="w-full rounded-full border border-[#365a94] bg-[#0d1f3f] px-2 py-2 text-[10px] text-[#e8eefc] sm:px-3 sm:text-[11px]"
          />
          <button
            type="button"
            onClick={runSearch}
            disabled={!searchQuery.trim() || searchLoading}
            className="rounded-full bg-[#d1a741] px-3 py-2 text-[10px] font-semibold text-[#091631] disabled:opacity-60"
          >
            {searchLoading ? "..." : "Go"}
          </button>
          <button
            type="button"
            onClick={onFiltersClick}
            className="w-full rounded-full border border-[#365a94] bg-[#0d1f3f] px-3 py-2 text-[10px] font-semibold text-[#d6e5ff] sm:hidden"
          >
            Filters
          </button>
        </div>
        {searchError && (
          <p className="mt-2 text-[10px] text-[#b3261e]">{searchError}</p>
        )}
        {searchResults.length > 0 && (
          <div className="mt-2 max-h-36 overflow-auto rounded-xl border border-[#eadfce] bg-white">
            {searchResults.map((result) => (
              <button
                key={result.id}
                type="button"
                onClick={() => {
                  setSearchResults([]);
                  mapRef.current?.setCenter({
                    lat: result.center[1],
                    lng: result.center[0],
                  });
                  mapRef.current?.setZoom(16);
                }}
                className="block w-full border-b border-[#f1e6d7] px-3 py-2 text-left text-[10px] text-[#5a4a44] hover:bg-[#fbf8f3]"
              >
                {result.place_name}
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 text-[10px] text-[#7a5f54]">
          Search uses Google Maps geocoding.
        </p>
        {(favoritePlots.length > 0 || recentPlots.length > 0) && (
          <div className="mt-2 space-y-2 text-[10px]">
            {favoritePlots.length > 0 && (
              <div>
                <p className="text-[#7a5f54]">Favorites</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {favoritePlots.slice(0, 4).map((plot) => (
                    <button
                      key={`fav-${plot.id}`}
                      type="button"
                      onClick={() => {
                        setActivePlot(plot);
                        mapRef.current?.setCenter({
                          lat: plot.center[1],
                          lng: plot.center[0],
                        });
                        mapRef.current?.setZoom(16);
                      }}
                      className="rounded-full border border-[#eadfce] bg-white px-2 py-1 text-[10px] text-[#5a4a44]"
                    >
                      {plot.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {recentPlots.length > 0 && (
              <div>
                <p className="text-[#7a5f54]">Recently viewed</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {recentPlots.map((plot) => (
                    <button
                      key={`recent-${plot.id}`}
                      type="button"
                      onClick={() => {
                        setActivePlot(plot);
                        mapRef.current?.setCenter({
                          lat: plot.center[1],
                          lng: plot.center[0],
                        });
                        mapRef.current?.setZoom(16);
                      }}
                      className="rounded-full border border-[#eadfce] bg-white px-2 py-1 text-[10px] text-[#5a4a44]"
                    >
                      {plot.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {activePlot && (
          <div className="mt-2 space-y-1 text-[10px]">
            <p className="text-[#7a5f54]">Nearby essentials</p>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(essentialLayerConfig) as EssentialLayerKey[]).map((key) => (
                <button
                  key={`layer-${key}`}
                  type="button"
                  onClick={() =>
                    setEssentialEnabled((current) => ({
                      ...current,
                      [key]: !current[key],
                    }))
                  }
                  className={`rounded-full px-2 py-1 ${
                    essentialEnabled[key]
                      ? "bg-[#1f3d2d] text-white"
                      : "border border-[#eadfce] bg-white text-[#5a4a44]"
                  }`}
                >
                  {essentialLayerConfig[key].label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div ref={containerRef} className="h-full w-full" />

      {activePlot && (
        <div className="absolute inset-x-3 bottom-3 z-20 w-auto max-h-[calc(100%-1.5rem)] overflow-y-auto rounded-3xl border border-[#eadfce] bg-white/95 p-4 text-xs shadow-[0_20px_60px_-40px_rgba(20,17,15,0.6)] backdrop-blur transition-transform duration-300 ease-out animate-slide-up sm:inset-x-auto sm:bottom-6 sm:right-6 sm:top-6 sm:w-[280px] sm:max-h-[calc(100%-3rem)] sm:overflow-y-auto">
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
                setGalleryOpen(false);
                setMutationFormOpen(false);
                setDistanceResults([]);
                setDistanceError(null);
                setDistanceTargetName(null);
                setDistanceTargetCenter(null);
                setDistanceKm(null);
                setRouteSummary(null);
                directionsRendererRef.current?.setMap(null);
                directionsRendererRef.current = null;
                setVisitBookingOpen(false);
                setVisitName("");
                setVisitPhone("");
                setVisitDate("");
                setVisitNote("");
                setVisitError(null);
                setVisitSuccess(null);
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
            {(activePlot.soldParcelIds?.length ?? 0) > 0 && (
              <p className="text-[#8b2f2f]">
                Sold parcels: {activePlot.soldParcelIds?.join(", ")}
              </p>
            )}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() =>
                setFavoritePlotIds((current) =>
                  current.includes(activePlot.id)
                    ? current.filter((id) => id !== activePlot.id)
                    : [activePlot.id, ...current].slice(0, 20)
                )
              }
              className={`rounded-full px-3 py-2 text-[11px] font-semibold ${
                favoritePlotIds.includes(activePlot.id)
                  ? "bg-[#c77d4b] text-white"
                  : "border border-[#1f3d2d]/30 text-[#1f3d2d]"
              }`}
            >
              {favoritePlotIds.includes(activePlot.id)
                ? "Saved to favorites"
                : "Add to favorites"}
            </button>
            <button
              type="button"
              onClick={() => setVisitBookingOpen((current) => !current)}
              className="rounded-full border border-[#1f3d2d]/30 px-3 py-2 text-[11px] font-semibold text-[#1f3d2d]"
            >
              {visitBookingOpen ? "Close visit form" : "Request site visit"}
            </button>
          </div>
          {visitBookingOpen && (
            <div className="mt-2 rounded-2xl border border-[#eadfce] bg-white p-3">
              <p className="text-[10px] uppercase tracking-[0.2em] text-[#a67047]">
                Visit booking
              </p>
              <div className="mt-2 space-y-2">
                <input
                  type="text"
                  value={visitName}
                  onChange={(event) => setVisitName(event.target.value)}
                  placeholder="Your name"
                  className="w-full rounded-2xl border border-[#eadfce] px-3 py-2 text-[11px]"
                />
                <input
                  type="tel"
                  value={visitPhone}
                  onChange={(event) => setVisitPhone(event.target.value)}
                  placeholder="Phone number"
                  className="w-full rounded-2xl border border-[#eadfce] px-3 py-2 text-[11px]"
                />
                <input
                  type="datetime-local"
                  value={visitDate}
                  onChange={(event) => setVisitDate(event.target.value)}
                  className="w-full rounded-2xl border border-[#eadfce] px-3 py-2 text-[11px]"
                />
                <textarea
                  rows={2}
                  value={visitNote}
                  onChange={(event) => setVisitNote(event.target.value)}
                  placeholder="Any note for the agent"
                  className="w-full rounded-2xl border border-[#eadfce] px-3 py-2 text-[11px]"
                />
                {visitError && <p className="text-[10px] text-[#b3261e]">{visitError}</p>}
                {visitSuccess && (
                  <p className="text-[10px] text-[#1f3d2d]">{visitSuccess}</p>
                )}
                <button
                  type="button"
                  onClick={submitVisitBooking}
                  disabled={visitSaving}
                  className="w-full rounded-full bg-[#1f3d2d] px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-60"
                >
                  {visitSaving ? "Submitting..." : "Submit visit request"}
                </button>
              </div>
            </div>
          )}
          <div className="mt-3 rounded-2xl border border-[#eadfce] bg-white p-3">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[#a67047]">
              Distance checker
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={distanceQuery}
                onChange={(event) => setDistanceQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    runDistanceSearch();
                  }
                }}
                placeholder="Search a location"
                className="w-full rounded-full border border-[#eadfce] bg-white px-3 py-2 text-[11px] text-[#14110f]"
              />
              <button
                type="button"
                onClick={runDistanceSearch}
                disabled={!distanceQuery.trim() || distanceLoading}
                className="rounded-full bg-[#1f3d2d] px-3 py-2 text-[10px] font-semibold text-white disabled:opacity-60"
              >
                {distanceLoading ? "..." : "Go"}
              </button>
            </div>
            {distanceError && (
              <p className="mt-2 text-[10px] text-[#b3261e]">{distanceError}</p>
            )}
            {distanceResults.length > 0 && (
              <div className="mt-2 max-h-28 overflow-auto rounded-xl border border-[#eadfce] bg-white">
                {distanceResults.map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    onClick={() => {
                      setDistanceResults([]);
                      setDistanceTargetName(result.place_name);
                      setDistanceTargetCenter(result.center);
                      const km = distanceBetweenKm(activePlot.center, result.center);
                      setDistanceKm(km);
                      drawRouteToPlot(result.center, activePlot.center);
                    }}
                    className="block w-full border-b border-[#f1e6d7] px-3 py-2 text-left text-[10px] text-[#5a4a44] hover:bg-[#fbf8f3]"
                  >
                    {result.place_name}
                  </button>
                ))}
              </div>
            )}
            {distanceKm !== null && distanceTargetName && (
              <p className="mt-2 text-[11px] text-[#1f3d2d]">
                Distance to {distanceTargetName}:{" "}
                <span className="font-semibold">{formatDistance(distanceKm)}</span>
              </p>
            )}
            {routeLoading && (
              <p className="mt-1 text-[10px] text-[#7a5f54]">Loading route...</p>
            )}
            {routeSummary && (
              <p className="mt-1 text-[10px] text-[#5a4a44]">
                Drive route: {routeSummary.distance} ({routeSummary.duration})
              </p>
            )}
            {distanceTargetCenter && (
              <button
                type="button"
                onClick={() => drawRouteToPlot(distanceTargetCenter, activePlot.center)}
                className="mt-2 rounded-full border border-[#eadfce] px-3 py-1 text-[10px] text-[#1f3d2d]"
              >
                Refresh route
              </button>
            )}
          </div>
          <div className="mt-2 rounded-2xl border border-[#eadfce] bg-white p-3">
            <button
              type="button"
              onClick={() => {
                const destination = `${activePlot.center[1]},${activePlot.center[0]}`;
                const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                  destination
                )}`;
                window.open(url, "_blank", "noopener,noreferrer");
              }}
              className="w-full rounded-full border border-[#1f3d2d]/30 px-3 py-2 text-[11px] font-semibold text-[#1f3d2d]"
            >
              Share to Maps
            </button>
            <p className="mt-2 text-[10px] text-[#7a5f54]">
              Share parcel location to Google Maps to get directions for accessing
              this parcel.
            </p>
          </div>
          {!inquiryOpen ? (
            <>
              {activePlot.mutationForm?.url && (
                <button
                  type="button"
                  onClick={() => {
                    setMutationFormOpen(true);
                    setSoldOverlays([]);
                  }}
                  className="mt-2 w-full rounded-full border border-[#1f3d2d]/30 px-3 py-2 text-[11px] font-semibold text-[#1f3d2d]"
                >
                  View mutation form
                </button>
              )}
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

      {galleryOpen && activePlot && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-2xl rounded-3xl border border-[#eadfce] bg-[#fbf8f3] p-6 shadow-[0_30px_70px_-40px_rgba(20,17,15,0.6)]">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-[#a67047]">
                  Surrounding images
                </p>
                <p className="mt-2 text-lg font-semibold text-[#14110f]">
                  {activePlot.label}
                </p>
                <p className="mt-1 text-xs text-[#5a4a44]">
                  {listingImages.length > 0
                    ? `Image ${galleryIndex + 1} of ${listingImages.length}`
                    : "No images available"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setGalleryOpen(false)}
                className="rounded-full border border-[#eadfce] px-3 py-1 text-xs text-[#5a4a44]"
              >
                Close
              </button>
            </div>

            <div className="mt-5 overflow-hidden rounded-3xl border border-[#eadfce] bg-[radial-gradient(circle_at_top,_#f4ede2,_#f0e6d7_50%,_#efe1cd)]">
              {listingImages.length > 0 ? (
                <img
                  src={listingImages[galleryIndex]?.url}
                  alt={listingImages[galleryIndex]?.name || "Surrounding image"}
                  className="h-[320px] w-full object-cover"
                />
              ) : (
                <div className="flex h-[280px] items-center justify-center text-sm text-[#6b3e1e]">
                  No surrounding images available yet.
                </div>
              )}
            </div>

            {listingImages.length > 1 && (
              <div className="mt-4 flex items-center justify-between text-xs text-[#5a4a44]">
                <button
                  type="button"
                  onClick={() =>
                    setGalleryIndex((current) => Math.max(current - 1, 0))
                  }
                  className="rounded-full border border-[#eadfce] px-3 py-1"
                  disabled={galleryIndex === 0}
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setGalleryIndex((current) =>
                      Math.min(current + 1, listingImages.length - 1)
                    )
                  }
                  className="rounded-full bg-[#c77d4b] px-3 py-1 text-white"
                  disabled={galleryIndex >= listingImages.length - 1}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {mutationFormOpen && activePlot?.mutationForm?.url && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 px-3 py-3 sm:px-4 sm:py-6">
          <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-3xl border border-[#eadfce] bg-[#fbf8f3] p-4 shadow-[0_30px_70px_-40px_rgba(20,17,15,0.6)] sm:p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-[#14110f]">
                Mutation form
              </p>
              <button
                type="button"
                onClick={() => setMutationFormOpen(false)}
                className="rounded-full border border-[#eadfce] px-3 py-1 text-xs text-[#5a4a44]"
              >
                Close
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(activePlot.soldParcelIds?.length ?? 0) === 0 && (
                <span className="text-[11px] text-[#7a5f54]">
                  No sold parcels yet.
                </span>
              )}
              {soldOverlays.length > 0 && (
                <span className="rounded-full border border-[#eadfce] bg-white px-3 py-1 text-[11px] text-[#8b2f2f]">
                  Highlighting {soldOverlays.length} sold parcel(s)
                </span>
              )}
              {!mutationFormIsPdf &&
                (activePlot.soldParcelIds?.length ?? 0) > 0 &&
                soldOverlays.length === 0 && (
                  <span className="text-[11px] text-[#7a5f54]">
                    Parcel polygons were not extracted for this mutation form.
                  </span>
                )}
            </div>
            <div className="mt-4 h-[58vh] overflow-hidden rounded-2xl border border-[#eadfce] bg-white sm:h-[65vh]">
              {mutationFormIsPdf ? (
                <iframe
                  src={activePlot.mutationForm.url}
                  title={activePlot.mutationForm.name || "Mutation form"}
                  className="h-full w-full"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center p-2">
                  <div className="relative inline-block max-h-full max-w-full">
                    <img
                      src={activePlot.mutationForm.url}
                      alt={activePlot.mutationForm.name || "Mutation form"}
                      className="block max-h-[62vh] max-w-full"
                    />
                    <svg
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                      className="pointer-events-none absolute inset-0 h-full w-full"
                    >
                      {soldOverlays.map((overlay) => (
                        <polygon
                          key={`sold-overlay-${overlay.parcelNumber}`}
                          points={overlay.points
                            .map((point) => `${point.x},${point.y}`)
                            .join(" ")}
                          fill="rgba(179,38,30,0.33)"
                          stroke="rgba(124,24,19,0.9)"
                          strokeWidth="0.6"
                        />
                      ))}
                    </svg>
                  </div>
                </div>
              )}
            </div>
            {soldOverlays.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[#5a4a44]">
                {soldOverlays.map((overlay) => (
                  <span
                    key={`sold-pill-${overlay.parcelNumber}`}
                    className="rounded-full border border-[#eadfce] bg-white px-3 py-1"
                  >
                    Parcel {overlay.parcelNumber}
                    {typeof overlay.confidence === "number"
                      ? ` (${Math.round(overlay.confidence * 100)}%)`
                      : ""}
                  </span>
                ))}
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
      `}</style>
    </div>
  );
}
