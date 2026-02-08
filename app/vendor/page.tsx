"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db, storage } from "../../lib/firebase";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

type VendorPlot = {
  id: string;
  name: string;
  status: string;
  acres: string;
  price: string;
  confidence: string;
  totalParcels: number;
  soldParcelIds: number[];
  availableParcels?: number;
};

const initialPlots: VendorPlot[] = [];

type DraftListing = {
  id: string;
  name: string;
  acres: string;
  price: string;
  updated: string;
  step: 1 | 2 | 3;
  amenities: string[];
};

type DraftNode = {
  id: number;
  label: string;
  files: FileList | null;
  coords?: { lat: number; lng: number };
  imageUrl?: string;
};

type Inquiry = {
  id: string;
  buyer: string;
  parcel: string;
  intent: "High" | "Medium" | "Low";
  time: string;
  phone: string;
  preferredContact: "Call" | "Text" | "WhatsApp";
  message: string;
};

const inquiriesSeed: Inquiry[] = [];

type SoldListing = {
  id: string;
  name: string;
  acres: string;
  price: string;
  soldOn: string;
  totalParcels?: number;
  soldParcels?: number;
};

const initialSoldListings: SoldListing[] = [];

type SaleInstallment = {
  id: number;
  amount: string;
  date: string;
  method: "Cash" | "Bank transfer" | "Mobile money";
  proofName?: string;
  proofUrl?: string;
};

type SalesRecord = {
  id: string;
  parcelName: string;
  parcelId: string;
  buyer: string;
  salePrice: number;
  processingFee: number;
  netToVendor: number;
  totalPaid: number;
  remainingBalance: number;
  installments: SaleInstallment[];
  soldOn: string;
  agreementFile: string;
};

const initialPendingSales: SalesRecord[] = [];

const initialSales: SalesRecord[] = [];


export default function VendorDashboard() {
  const [newListingOpen, setNewListingOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "active" | "drafts" | "inquiries" | "pending" | "sales"
  >("active");
  const [plots, setPlots] = useState<VendorPlot[]>(initialPlots);
  const [soldListings, setSoldListings] = useState<SoldListing[]>(
    initialSoldListings
  );
  const [salesRecords, setSalesRecords] =
    useState<SalesRecord[]>(initialSales);
  const [pendingSalesRecords, setPendingSalesRecords] =
    useState<SalesRecord[]>(initialPendingSales);
  const [inquiries, setInquiries] = useState<Inquiry[]>(inquiriesSeed);
  const [draftListings, setDraftListings] = useState<DraftListing[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);
  const [selectedPlotId, setSelectedPlotId] = useState<string | null>(null);
  const [selectedParcelIndex, setSelectedParcelIndex] = useState<number | null>(
    null
  );
  const [selectedInquiryId, setSelectedInquiryId] = useState<string | null>(
    null
  );
  const [installmentDrafts, setInstallmentDrafts] = useState<
    Record<
      string,
      {
        amount: string;
        date: string;
        method: "Cash" | "Bank transfer" | "Mobile money";
        proofFile: File | null;
        saving?: boolean;
      }
    >
  >({});
  const [expandedPendingId, setExpandedPendingId] = useState<string | null>(
    null
  );
  const [installmentsOpenId, setInstallmentsOpenId] = useState<string | null>(
    null
  );
  const [saleModalOpen, setSaleModalOpen] = useState(false);
  const [saleDraft, setSaleDraft] = useState<{
    plotId: string;
    parcelIndex?: number | null;
    parcelName: string;
    defaultPrice: string;
  } | null>(null);
  const [buyerNameInput, setBuyerNameInput] = useState("");
  const [salePriceInput, setSalePriceInput] = useState("");
  const [saleType, setSaleType] = useState<"cash" | "installments">("cash");
  const [charges, setCharges] = useState<
    { id: number; label: string; amount: string; kind: "charge" | "expense" }[]
  >([{ id: 1, label: "Processing fee", amount: "0", kind: "charge" }]);
  const [installments, setInstallments] = useState<SaleInstallment[]>([]);
  const [vendorLogo, setVendorLogo] = useState<string | null>(null);
  const [listingParcel, setListingParcel] = useState("");
  const [listingSize, setListingSize] = useState("");
  const [listingPrice, setListingPrice] = useState("");
  const [listingStepError, setListingStepError] = useState<string | null>(null);
  const [listingAmenities, setListingAmenities] = useState<string[]>([]);
  const [listingStep, setListingStep] = useState<1 | 2 | 3>(1);
  const [panoramaNodes, setPanoramaNodes] = useState<
    DraftNode[]
  >([{ id: 1, label: "Node 1", files: null }]);
  const [streetPreviewOpen, setStreetPreviewOpen] = useState(false);
  const [streetPreviewIndex, setStreetPreviewIndex] = useState(0);
  const [streetPreviewPrevIndex, setStreetPreviewPrevIndex] = useState<
    number | null
  >(null);
  const [streetPreviewAnimating, setStreetPreviewAnimating] = useState(false);
  const [streetPreviewError, setStreetPreviewError] = useState<string | null>(
    null
  );
  const [streetPanValue, setStreetPanValue] = useState(50);
  const lastPreviewTapRef = useRef(0);
  const [subParcels, setSubParcels] = useState<
    {
      id: number;
      name: string;
      mappingActive: boolean;
      previewOpen: boolean;
      rawPath: { lat: number; lng: number }[];
      cleanPath: { lat: number; lng: number }[];
      gpsAccuracy?: number;
      waitingForFix?: boolean;
      hasGoodFix?: boolean;
    }[]
  >([
    {
      id: 1,
      name: "Parcel A",
      mappingActive: false,
      previewOpen: false,
      rawPath: [],
      cleanPath: [],
      gpsAccuracy: undefined,
      waitingForFix: false,
      hasGoodFix: false,
    },
  ]);
  const [locationStatus, setLocationStatus] = useState<string | null>(null);
  const [mapPreviewOpen, setMapPreviewOpen] = useState(false);
  const mapPreviewRef = useRef<HTMLDivElement | null>(null);
  const mapPreviewInstanceRef = useRef<maplibregl.Map | null>(null);
  const mapPreviewDragRef = useRef<{
    parcelId: number | null;
    lastLngLat: { lng: number; lat: number } | null;
  }>({ parcelId: null, lastLngLat: null });
  const headingRef = useRef<number | null>(null);
  const lastGpsTimestampRef = useRef<Record<number, number>>({});
  const watchIdRef = useRef<number | null>(null);
  const activeCaptureIdRef = useRef<number | null>(null);
  const [vendorProfile, setVendorProfile] = useState<{
    name: string;
    type: "Individual" | "Company";
    location?: string;
  } | null>(null);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const mapTilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  const mapPreviewStyleUrl = mapTilerKey
    ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${mapTilerKey}`
    : "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

  const getActiveVendorId = () => vendorId ?? auth.currentUser?.uid ?? null;

  const selectedPlot = plots.find((plot) => plot.id === selectedPlotId) ?? null;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setVendorProfile(null);
        setVendorId(null);
        return;
      }
      setVendorId(user.uid);
      const snap = await getDoc(doc(db, "vendors", user.uid));
      if (snap.exists()) {
        const data = snap.data() as {
          name?: string;
          type?: "Individual" | "Company";
        };
        setVendorProfile({
          name: data.name || "Vendor",
          type: data.type || "Individual",
          location: "Western District",
        });
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const loadDrafts = async () => {
      if (!vendorId) {
        setDraftListings([]);
        return;
      }
      await refreshDrafts(vendorId);
    };
    loadDrafts();
  }, [vendorId]);

  useEffect(() => {
    if (!window.DeviceOrientationEvent) return;
    const handler = (event: DeviceOrientationEvent) => {
      const heading =
        typeof (event as any).webkitCompassHeading === "number"
          ? (event as any).webkitCompassHeading
          : typeof event.alpha === "number"
          ? event.alpha
          : null;
      if (heading !== null) {
        headingRef.current = heading;
      }
    };
    window.addEventListener("deviceorientation", handler, true);
    return () => window.removeEventListener("deviceorientation", handler, true);
  }, []);

  useEffect(() => {
    const loadListings = async () => {
      if (!vendorId) return;
      const snapshot = await getDocs(
        query(collection(db, "listings"), where("vendorId", "==", vendorId))
      );
      const mapped: VendorPlot[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as {
          name?: string;
          acres?: string;
          price?: string;
          parcels?: { name?: string }[];
        };
        const totalParcels = data.parcels?.length ?? 1;
        mapped.push({
          id: docSnap.id,
          name: data.name || "Untitled",
          status: "Listed",
          acres: data.acres || "",
          price: data.price || "Ksh 0",
          confidence: "—",
          totalParcels,
          soldParcelIds: [],
          availableParcels: totalParcels,
        });
      });
      setPlots(mapped);
    };
    loadListings();
  }, [vendorId]);

  useEffect(() => {
    const loadSales = async () => {
      if (!vendorId) return;
      const pendingSnap = await getDocs(
        query(collection(db, "pendingSales"), where("vendorId", "==", vendorId))
      );
      const salesSnap = await getDocs(
        query(collection(db, "sales"), where("vendorId", "==", vendorId))
      );
      const mapSale = (docSnap: any): SalesRecord => {
        const data = docSnap.data() as SalesRecord & { createdAt?: any };
        return {
          ...data,
          id: docSnap.id,
        };
      };
      setPendingSalesRecords(pendingSnap.docs.map(mapSale));
      setSalesRecords(salesSnap.docs.map(mapSale));
    };
    loadSales();
  }, [vendorId]);

  useEffect(() => {
    const loadInquiries = async () => {
      if (!vendorProfile?.name) return;
      let snapshot;
      try {
        snapshot = await getDocs(
          query(
            collection(db, "inquiries"),
            where("vendorName", "==", vendorProfile.name),
            orderBy("createdAt", "desc")
          )
        );
      } catch {
        snapshot = await getDocs(
          query(
            collection(db, "inquiries"),
            where("vendorName", "==", vendorProfile.name)
          )
        );
      }
      const items: Inquiry[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as {
          buyerName?: string;
          buyerPhone?: string;
          preferredContact?: "Call" | "Text" | "WhatsApp";
          message?: string;
          plotLabel?: string;
          createdAt?: { toDate: () => Date };
        };
        const createdAt = data.createdAt?.toDate();
        items.push({
          id: docSnap.id,
          buyer: data.buyerName || "Buyer",
          parcel: data.plotLabel || "Parcel",
          intent: "High",
          time: createdAt ? createdAt.toLocaleString() : "Just now",
          phone: data.buyerPhone || "",
          preferredContact: data.preferredContact || "Call",
          message: data.message || "",
        });
      });
      setInquiries(items);
    };
    loadInquiries();
  }, [vendorProfile?.name]);

  const refreshDrafts = async (id: string) => {
    let snapshot;
    try {
      snapshot = await getDocs(
        query(
          collection(db, "draftListings"),
          where("vendorId", "==", id),
          orderBy("updatedAt", "desc")
        )
      );
    } catch {
      snapshot = await getDocs(
        query(collection(db, "draftListings"), where("vendorId", "==", id))
      );
    }
    const drafts: DraftListing[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data() as {
        name?: string;
        acres?: string;
        price?: string;
        step?: 1 | 2 | 3;
        amenities?: string[];
        updatedAt?: { toDate: () => Date };
      };
      const updatedAt = data.updatedAt?.toDate();
      drafts.push({
        id: docSnap.id,
        name: data.name || "Untitled",
        acres: data.acres || "",
        price: data.price || "",
        updated: updatedAt
          ? `Edited ${updatedAt.toLocaleDateString()}`
          : "Saved recently",
        step: data.step || 1,
        amenities: data.amenities || [],
      });
    });
    setDraftListings(drafts);
  };

  const earthRadius = 6371000;
  const minGpsAccuracyMeters = 3;
  const maxFusionAccuracyMeters = 10;
  const toXY = (point: { lat: number; lng: number }, origin: { lat: number; lng: number }) => {
    const dLat = ((point.lat - origin.lat) * Math.PI) / 180;
    const dLng = ((point.lng - origin.lng) * Math.PI) / 180;
    const latRad = (origin.lat * Math.PI) / 180;
    return {
      x: earthRadius * dLng * Math.cos(latRad),
      y: earthRadius * dLat,
    };
  };

  const distance = (
    a: { lat: number; lng: number },
    b: { lat: number; lng: number }
  ) => {
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) *
        Math.cos(lat2) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    return 2 * earthRadius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  };

  const perpendicularDistance = (
    point: { lat: number; lng: number },
    lineStart: { lat: number; lng: number },
    lineEnd: { lat: number; lng: number },
    origin: { lat: number; lng: number }
  ) => {
    const p = toXY(point, origin);
    const a = toXY(lineStart, origin);
    const b = toXY(lineEnd, origin);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) return distance(point, lineStart);
    const t =
      ((p.x - a.x) * dx + (p.y - a.y) * dy) /
      (dx * dx + dy * dy);
    const clamped = Math.max(0, Math.min(1, t));
    const proj = {
      x: a.x + clamped * dx,
      y: a.y + clamped * dy,
    };
    return Math.hypot(p.x - proj.x, p.y - proj.y);
  };

  const simplifyPath = (
    points: { lat: number; lng: number }[],
    epsilon: number
  ): { lat: number; lng: number }[] => {
    if (points.length < 3) return points;
    const origin = points[0];
    let index = 0;
    let maxDist = 0;
    for (let i = 1; i < points.length - 1; i += 1) {
      const dist = perpendicularDistance(
        points[i],
        points[0],
        points.at(-1)!,
        origin
      );
      if (dist > maxDist) {
        index = i;
        maxDist = dist;
      }
    }
    if (maxDist > epsilon) {
      const left = simplifyPath(points.slice(0, index + 1), epsilon);
      const right = simplifyPath(points.slice(index), epsilon);
      return [...left.slice(0, -1), ...right];
    }
    return [points[0], points.at(-1)!];
  };

  const closeLoop = (points: { lat: number; lng: number }[]) => {
    if (points.length < 2) return points;
    const first = points[0];
    const last = points.at(-1)!;
    const gap = distance(first, last);
    if (gap < 2) return points;
    return [...points, first];
  };

  const smoothPoint = (
    prev: { lat: number; lng: number } | null,
    next: { lat: number; lng: number },
    accuracy: number
  ) => {
    if (!prev) return next;
    const weight = Math.min(0.85, Math.max(0.25, 1 - accuracy / 12));
    return {
      lat: prev.lat + (next.lat - prev.lat) * weight,
      lng: prev.lng + (next.lng - prev.lng) * weight,
    };
  };

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const movePoint = (
    origin: { lat: number; lng: number },
    distanceMeters: number,
    bearingDeg: number
  ) => {
    const bearing = toRad(bearingDeg);
    const lat1 = toRad(origin.lat);
    const lng1 = toRad(origin.lng);
    const angDist = distanceMeters / earthRadius;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angDist) +
        Math.cos(lat1) * Math.sin(angDist) * Math.cos(bearing)
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angDist) * Math.cos(lat1),
        Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2)
      );
    return { lat: toDeg(lat2), lng: toDeg(lng2) };
  };

  const pathLength = (points: { lat: number; lng: number }[]) =>
    points.reduce((sum, point, idx) => {
      if (idx === 0) return sum;
      return sum + distance(point, points[idx - 1]);
    }, 0);

  const buildSvgPath = (
    points: { lat: number; lng: number }[],
    width: number,
    height: number
  ) => {
    if (points.length === 0) return "";
    const origin = points[0];
    const projected = points.map((point) => toXY(point, origin));
    const xs = projected.map((p) => p.x);
    const ys = projected.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const pad = 8;
    const scale = Math.min(
      (width - pad * 2) / spanX,
      (height - pad * 2) / spanY
    );
    return projected
      .map((p, idx) => {
        const x = (p.x - minX) * scale + pad;
        const y = (p.y - minY) * scale + pad;
        return `${idx === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  };

  const previewNodes = panoramaNodes.filter((node) => node.imageUrl);

  useEffect(() => {
    if (streetPreviewPrevIndex === null) return;
    const timer = setTimeout(() => {
      setStreetPreviewPrevIndex(null);
      setStreetPreviewAnimating(false);
    }, 350);
    return () => clearTimeout(timer);
  }, [streetPreviewPrevIndex, streetPreviewIndex]);

  useEffect(() => {
    if (!previewNodes.length) {
      setStreetPreviewOpen(false);
      setStreetPreviewIndex(0);
      setStreetPreviewPrevIndex(null);
      setStreetPreviewAnimating(false);
      return;
    }
    if (streetPreviewIndex >= previewNodes.length) {
      setStreetPreviewIndex(previewNodes.length - 1);
    }
  }, [previewNodes.length, streetPreviewIndex]);

  const openStreetPreview = () => {
    if (!previewNodes.length) {
      setStreetPreviewError("Add at least one node photo to preview.");
      return;
    }
    setStreetPreviewError(null);
    setStreetPreviewIndex(0);
    setStreetPreviewPrevIndex(null);
    setStreetPreviewAnimating(false);
    setStreetPanValue(50);
    setStreetPreviewOpen(true);
  };

  const goToPreviewIndex = (index: number) => {
    if (!previewNodes.length) return;
    const bounded = Math.max(0, Math.min(index, previewNodes.length - 1));
    if (bounded === streetPreviewIndex) return;
    setStreetPreviewPrevIndex(streetPreviewIndex);
    setStreetPreviewIndex(bounded);
    setStreetPreviewAnimating(true);
  };

  const mapPreviewParcels = useMemo(
    () =>
      subParcels
        .filter((parcel) => parcel.cleanPath.length >= 3)
        .map((parcel) => ({
          id: parcel.id,
          name: parcel.name,
          polygon: closeLoop(parcel.cleanPath).map((point) => [
            point.lng,
            point.lat,
          ]) as [number, number][],
        })),
    [subParcels]
  );

  useEffect(() => {
    if (!mapPreviewOpen) return;
    if (!mapPreviewRef.current) return;

    if (!mapPreviewInstanceRef.current) {
      const map = new maplibregl.Map({
        container: mapPreviewRef.current,
        style: mapPreviewStyleUrl,
        center: [36.668, -1.248],
        zoom: 14,
      });
      map.addControl(new maplibregl.NavigationControl(), "bottom-right");
      mapPreviewInstanceRef.current = map;

      map.on("load", () => {
        map.addSource("parcel-preview", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [],
          },
        });
        map.addLayer({
          id: "parcel-preview-fill",
          type: "fill",
          source: "parcel-preview",
          paint: {
            "fill-color": "#c77d4b",
            "fill-opacity": 0.3,
          },
        });
        map.addLayer({
          id: "parcel-preview-line",
          type: "line",
          source: "parcel-preview",
          paint: {
            "line-color": "#1f3d2d",
            "line-width": 2,
          },
        });
      });

      map.on("mousedown", "parcel-preview-fill", (event) => {
        const feature = event.features?.[0];
        const id = feature?.properties?.id as number | undefined;
        if (!id) return;
        map.getCanvas().style.cursor = "grabbing";
        mapPreviewDragRef.current = {
          parcelId: id,
          lastLngLat: event.lngLat,
        };
      });

      map.on("mousemove", (event) => {
        const dragState = mapPreviewDragRef.current;
        if (!dragState.parcelId || !dragState.lastLngLat) return;
        const deltaLng = event.lngLat.lng - dragState.lastLngLat.lng;
        const deltaLat = event.lngLat.lat - dragState.lastLngLat.lat;
        dragState.lastLngLat = event.lngLat;

        setSubParcels((current) =>
          current.map((parcel) => {
            if (parcel.id !== dragState.parcelId) return parcel;
            const translate = (points: { lat: number; lng: number }[]) =>
              points.map((point) => ({
                lat: point.lat + deltaLat,
                lng: point.lng + deltaLng,
              }));
            return {
              ...parcel,
              rawPath: translate(parcel.rawPath),
              cleanPath: translate(parcel.cleanPath),
            };
          })
        );
      });

      const stopDrag = () => {
        if (mapPreviewInstanceRef.current) {
          mapPreviewInstanceRef.current.getCanvas().style.cursor = "";
        }
        mapPreviewDragRef.current = { parcelId: null, lastLngLat: null };
      };

      map.on("mouseup", stopDrag);
      map.on("mouseleave", stopDrag);
    }
  }, [mapPreviewOpen]);

  useEffect(() => {
    if (mapPreviewOpen) return;
    if (mapPreviewInstanceRef.current) {
      mapPreviewInstanceRef.current.remove();
      mapPreviewInstanceRef.current = null;
    }
  }, [mapPreviewOpen]);

  useEffect(() => {
    const map = mapPreviewInstanceRef.current;
    if (!map) return;
    const source = map.getSource("parcel-preview") as maplibregl.GeoJSONSource;
    if (!source) return;
    source.setData({
      type: "FeatureCollection",
      features: mapPreviewParcels.map((parcel) => ({
        type: "Feature",
        properties: { id: parcel.id },
        geometry: {
          type: "Polygon",
          coordinates: [parcel.polygon],
        },
      })),
    });
    if (mapPreviewParcels.length) {
      const bounds = new maplibregl.LngLatBounds();
      mapPreviewParcels.forEach((parcel) => {
        parcel.polygon.forEach((coord) => bounds.extend(coord));
      });
      map.fitBounds(bounds, { padding: 40, duration: 600 });
    }
  }, [mapPreviewParcels]);

  const handlePreviewAdvance = () => {
    goToPreviewIndex(streetPreviewIndex + 1);
  };

  const handlePreviewTouch = () => {
    const now = Date.now();
    if (now - lastPreviewTapRef.current < 300) {
      handlePreviewAdvance();
    }
    lastPreviewTapRef.current = now;
  };

  const startGpsCapture = (parcelId: number) => {
    if (!navigator.geolocation) {
      setLocationStatus("GPS not supported on this device.");
      return;
    }
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    activeCaptureIdRef.current = parcelId;
    setLocationStatus(
      `Waiting for GPS accuracy ≤${minGpsAccuracyMeters}m...`
    );
    setSubParcels((current) =>
      current.map((item) =>
        item.id === parcelId
          ? {
              ...item,
              mappingActive: true,
              previewOpen: true,
              rawPath: [],
              cleanPath: [],
              waitingForFix: true,
              hasGoodFix: false,
            }
          : item
      )
    );
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const accuracy = pos.coords.accuracy ?? 0;
        setLocationStatus(
          accuracy
            ? `GPS accuracy ±${Math.round(accuracy)}m`
            : "GPS signal acquired"
        );
        const nextPoint = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        let fusedPoint = nextPoint;
        setSubParcels((current) => {
          const parcel = current.find((item) => item.id === parcelId);
          if (!parcel) return current;
          const lastPoint = parcel.rawPath[parcel.rawPath.length - 1] ?? null;
          const lastTimestamp = lastGpsTimestampRef.current[parcelId];
          const dt =
            typeof lastTimestamp === "number"
              ? Math.max((pos.timestamp - lastTimestamp) / 1000, 0)
              : 0;
          const heading = headingRef.current;
          const speed = pos.coords.speed ?? 0;
          if (lastPoint && heading !== null && speed > 0.2 && dt > 0) {
            const projected = movePoint(lastPoint, speed * dt, heading);
            fusedPoint = smoothPoint(lastPoint, projected, accuracy);
          } else if (lastPoint) {
            fusedPoint = smoothPoint(lastPoint, nextPoint, accuracy);
          }
          lastGpsTimestampRef.current[parcelId] = pos.timestamp;

          if (!parcel.hasGoodFix && accuracy > minGpsAccuracyMeters) {
            return current.map((item) =>
              item.id === parcelId
                ? { ...item, gpsAccuracy: accuracy, waitingForFix: true }
                : item
            );
          }

          if (accuracy > minGpsAccuracyMeters) {
            if (accuracy <= maxFusionAccuracyMeters && lastPoint && heading !== null) {
              const nextRaw = [...parcel.rawPath, fusedPoint];
              const nextClean = simplifyPath(nextRaw, 5);
              return current.map((item) =>
                item.id === parcelId
                  ? {
                      ...item,
                      rawPath: nextRaw,
                      cleanPath: nextClean,
                      gpsAccuracy: accuracy,
                      waitingForFix: false,
                      hasGoodFix: true,
                    }
                  : item
              );
            }
            return current.map((item) =>
              item.id === parcelId
                ? { ...item, gpsAccuracy: accuracy, waitingForFix: true }
                : item
            );
          }

          if (lastPoint && distance(lastPoint, fusedPoint) < 2) {
            return current.map((item) =>
              item.id === parcelId
                ? {
                    ...item,
                    gpsAccuracy: accuracy,
                    waitingForFix: false,
                    hasGoodFix: true,
                  }
                : item
            );
          }
          const nextRaw = [...parcel.rawPath, fusedPoint];
          const nextClean = simplifyPath(nextRaw, 5);
          return current.map((item) =>
            item.id === parcelId
              ? {
                  ...item,
                  rawPath: nextRaw,
                  cleanPath: nextClean,
                  gpsAccuracy: accuracy,
                  waitingForFix: false,
                  hasGoodFix: true,
                }
              : item
          );
        });
      },
      () => {
        setLocationStatus("Unable to read GPS. Try moving to open sky.");
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  };

  const stopGpsCapture = (parcelId: number) => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    activeCaptureIdRef.current = null;
    setLocationStatus(null);
    setSubParcels((current) =>
      current.map((item) => {
        if (item.id !== parcelId) return item;
        const closedRaw = closeLoop(item.rawPath);
        const cleaned = simplifyPath(closedRaw, 5);
        const closedClean = closeLoop(cleaned);
        return {
          ...item,
          mappingActive: false,
          previewOpen: true,
          cleanPath: closedClean,
          waitingForFix: false,
        };
      })
    );
  };

  const parsePrice = (price: string) => {
    const numeric = Number(price.replace(/[^0-9.]/g, ""));
    if (price.toLowerCase().includes("k")) {
      return numeric * 1000;
    }
    return numeric;
  };

  const normalizeKshPrice = (price: string) => {
    const trimmed = price.trim();
    if (!trimmed) return "";
    const cleaned = trimmed
      .replace(/^ksh\s*/i, "")
      .replace(/^usd\s*/i, "")
      .replace(/^[$€£]\s*/i, "")
      .trim()
      .replace(/\s+/g, " ");
    return cleaned ? `Ksh ${cleaned}` : "";
  };

  const formatKshInput = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const numeric = trimmed.replace(/[^0-9.]/g, "");
    if (!numeric) return trimmed;
    const [wholeRaw, decimalRaw] = numeric.split(".");
    const whole = wholeRaw.replace(/^0+(?=\d)/, "");
    const formattedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const decimal = decimalRaw ? `.${decimalRaw}` : "";
    return `Ksh ${formattedWhole || "0"}${decimal}`;
  };

  const totalPostedValue =
    plots.reduce((sum, plot) => {
      const totalParcels = plot.totalParcels ?? 1;
      return sum + parsePrice(plot.price) * totalParcels;
    }, 0) +
    soldListings.reduce((sum, sold) => {
      const totalParcels = sold.totalParcels ?? 1;
      return sum + parsePrice(sold.price) * totalParcels;
    }, 0);
  const totalSoldValue = salesRecords.reduce(
    (sum, sale) => sum + sale.salePrice,
    0
  );
  const totalExistingValue = Math.max(totalPostedValue - totalSoldValue, 0);

  const movePendingToSales = (saleId: string) => {
    setPendingSalesRecords((current) => {
      const sale = current.find((item) => item.id === saleId);
      if (!sale) return current;
      setSalesRecords((prev) => [
        {
          ...sale,
          totalPaid: sale.netToVendor,
          remainingBalance: 0,
        },
        ...prev,
      ]);
      return current.filter((item) => item.id !== saleId);
    });
  };

  const updatePendingInstallments = (
    saleId: string,
    updater: (installments: SaleInstallment[]) => SaleInstallment[]
  ) => {
    setPendingSalesRecords((current) => {
      const activeVendorId = getActiveVendorId();
      const updated = current.map((sale) => {
        if (sale.id !== saleId) return sale;
        const nextInstallments = updater(sale.installments);
        const totalPaid = nextInstallments.reduce((sum, item) => {
          const paid = Number(item.amount) || 0;
          return sum + paid;
        }, 0);
        const remainingBalance = Math.max(sale.netToVendor - totalPaid, 0);
        if (activeVendorId) {
          setDoc(
            doc(db, "pendingSales", sale.id),
            {
              installments: nextInstallments,
              totalPaid,
              remainingBalance,
            },
            { merge: true }
          );
        }
        return {
          ...sale,
          installments: nextInstallments,
          totalPaid,
          remainingBalance,
        };
      });

      const toMove = updated.filter((sale) => sale.remainingBalance <= 0);
      if (toMove.length > 0) {
        setSalesRecords((prev) => [...toMove, ...prev]);
        if (activeVendorId) {
          toMove.forEach(async (sale) => {
            await setDoc(doc(db, "sales", sale.id), {
              vendorId: activeVendorId,
              ...sale,
              createdAt: serverTimestamp(),
            });
            await deleteDoc(doc(db, "pendingSales", sale.id));
          });
        }
      }
      return updated.filter((sale) => sale.remainingBalance > 0);
    });
  };

  const submitPendingInstallment = async (saleId: string) => {
    const draft = installmentDrafts[saleId];
    if (!draft) return;
    const amount = Number(draft.amount) || 0;
    if (!amount || !draft.date) return;
    setInstallmentDrafts((current) => ({
      ...current,
      [saleId]: { ...draft, saving: true },
    }));
    let proofName = "";
    let proofUrl = "";
    const activeVendorId = getActiveVendorId();
    if (draft.proofFile && activeVendorId) {
      const fileRef = ref(
        storage,
        `vendors/${activeVendorId}/pending-sales/${saleId}-${draft.proofFile.name}`
      );
      try {
        await uploadBytes(fileRef, draft.proofFile);
        proofName = draft.proofFile.name;
        proofUrl = await getDownloadURL(fileRef);
      } catch {
        proofName = draft.proofFile.name;
      }
    }
    updatePendingInstallments(saleId, (items) => [
      ...items,
      {
        id: Date.now(),
        amount: draft.amount,
        date: draft.date,
        method: draft.method,
        proofName,
        proofUrl,
      },
    ]);
    setInstallmentDrafts((current) => ({
      ...current,
      [saleId]: {
        amount: "",
        date: "",
        method: "Mobile money",
        proofFile: null,
        saving: false,
      },
    }));
    setExpandedPendingId(null);
  };

  const markPlotSold = (plotId: string, parcelIndex?: number | null) => {
    setPlots((current) => {
      return current.flatMap((plot) => {
        if (plot.id !== plotId) {
          return [plot];
        }

        const totalParcels = plot.totalParcels ?? 1;
        const nextSold = parcelIndex ?? 1;
        const alreadySold = plot.soldParcelIds?.includes(nextSold);
        const updatedSold = alreadySold
          ? plot.soldParcelIds
          : [...(plot.soldParcelIds ?? []), nextSold];
        const availableParcels = Math.max(totalParcels - updatedSold.length, 0);

        if (updatedSold.length >= totalParcels) {
          setSoldListings((sold) => [
            {
              id: `SLD-${plot.id.replace("PT-", "")}`,
              name: plot.name,
              acres: plot.acres,
              price: plot.price,
              soldOn: "Sold today",
              totalParcels,
              soldParcels: updatedSold.length,
            },
            ...sold,
          ]);
          setSelectedPlotId(null);
          setSelectedParcelIndex(null);
          return [];
        }

        return [
          {
            ...plot,
            availableParcels,
            soldParcelIds: updatedSold,
          },
        ];
      });
    });
  };

  const openSaleModal = (plotId: string, parcelIndex?: number | null) => {
    const plot = plots.find((item) => item.id === plotId);
    if (!plot) return;
    setSaleDraft({
      plotId,
      parcelIndex,
      parcelName: plot.name,
      defaultPrice: plot.price,
    });
    setBuyerNameInput("");
    setSalePriceInput(plot.price.replace(/[^0-9.]/g, ""));
    setCharges([{ id: 1, label: "Processing fee", amount: "0", kind: "charge" }]);
    setInstallments([]);
    setSaleType("cash");
    setSaleModalOpen(true);
  };

  const confirmSale = () => {
    if (!saleDraft) return;
    const activeVendorId = getActiveVendorId();
    const salePrice = Number(salePriceInput) || 0;
    const totalDeductions = charges.reduce((sum, charge) => {
      const fee = Number(charge.amount) || 0;
      return sum + fee;
    }, 0);
    const netToVendor = Math.max(salePrice - totalDeductions, 0);
    const today = new Date().toISOString().slice(0, 10);
    const normalizedInstallments =
      saleType === "cash"
        ? [
            {
              id: Date.now(),
              amount: netToVendor.toString(),
              date: today,
              method: "Cash" as const,
              proofName: "",
            },
          ]
        : installments;
    const totalPaid = normalizedInstallments.reduce((sum, installment) => {
      const paid = Number(installment.amount) || 0;
      return sum + paid;
    }, 0);
    const remainingBalance = Math.max(netToVendor - totalPaid, 0);

    const newRecord: SalesRecord = {
      id: `SALE-${Date.now().toString().slice(-4)}`,
      parcelName: saleDraft.parcelName,
      parcelId: saleDraft.plotId,
      buyer: buyerNameInput || "Buyer",
      salePrice,
      processingFee: totalDeductions,
      netToVendor,
      totalPaid,
      remainingBalance,
      installments: normalizedInstallments,
      soldOn: "Sold today",
      agreementFile: "",
    };
    if (remainingBalance > 0) {
      setPendingSalesRecords((current) => [newRecord, ...current]);
      if (activeVendorId) {
        setDoc(doc(db, "pendingSales", newRecord.id), {
          vendorId: activeVendorId,
          ...newRecord,
          createdAt: serverTimestamp(),
        });
      }
    } else {
      setSalesRecords((current) => [newRecord, ...current]);
      if (activeVendorId) {
        setDoc(doc(db, "sales", newRecord.id), {
          vendorId: activeVendorId,
          ...newRecord,
          createdAt: serverTimestamp(),
        });
      }
    }
    markPlotSold(saleDraft.plotId, saleDraft.parcelIndex);
    setSaleModalOpen(false);
    setSaleDraft(null);
  };

  const saveDraftStep = async (nextStep: 1 | 2 | 3) => {
    const activeVendorId = getActiveVendorId();
    if (!activeVendorId) return;
    setDraftSaving(true);
    try {
      if (!draftId) {
        const docRef = await addDoc(collection(db, "draftListings"), {
          vendorId: activeVendorId,
          name: listingParcel,
          acres: listingSize,
          price: normalizeKshPrice(listingPrice),
          amenities: listingAmenities,
          step: nextStep,
          nodes: panoramaNodes.map((node) => ({
            label: node.label,
            coords: node.coords ?? null,
            imageUrl: node.imageUrl ?? "",
          })),
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        });
        setDraftId(docRef.id);
        await refreshDrafts(activeVendorId);
      } else {
        await updateDoc(doc(db, "draftListings", draftId), {
          name: listingParcel,
          acres: listingSize,
          price: normalizeKshPrice(listingPrice),
          amenities: listingAmenities,
          step: nextStep,
          nodes: panoramaNodes.map((node) => ({
            label: node.label,
            coords: node.coords ?? null,
            imageUrl: node.imageUrl ?? "",
          })),
          updatedAt: serverTimestamp(),
        });
        await refreshDrafts(activeVendorId);
      }
    } finally {
      setDraftSaving(false);
    }
  };

  const finishListing = async () => {
    if (!vendorId) return;
    setDraftSaving(true);
    try {
      const listingPayload = {
        vendorId,
        vendorName: vendorProfile?.name ?? "Vendor",
        vendorType: vendorProfile?.type ?? "Individual",
        name: listingParcel,
        acres: listingSize,
        price: normalizeKshPrice(listingPrice),
        amenities: listingAmenities,
        nodes: panoramaNodes.map((node) => ({
          label: node.label,
          coords: node.coords ?? null,
          imageUrl: node.imageUrl ?? "",
        })),
        parcels: subParcels.map((parcel) => ({
          name: parcel.name,
          rawPath: parcel.rawPath,
          cleanPath: parcel.cleanPath,
        })),
        createdAt: serverTimestamp(),
      };
      const docRef = await addDoc(collection(db, "listings"), listingPayload);
      const totalParcels = subParcels.length || 1;
      const normalizedPrice = normalizeKshPrice(listingPrice);
      setPlots((current) => [
        {
          id: docRef.id,
          name: listingParcel || "Untitled",
          status: "Listed",
          acres: listingSize,
          price: normalizedPrice || "Ksh 0",
          confidence: "—",
          totalParcels,
          soldParcelIds: [],
          availableParcels: totalParcels,
        },
        ...current,
      ]);
      if (draftId) {
        await deleteDoc(doc(db, "draftListings", draftId));
        setDraftId(null);
      }
      await refreshDrafts(vendorId);
      setNewListingOpen(false);
    } finally {
      setDraftSaving(false);
    }
  };

  const validateListingStepOne = () => {
    const nameOk = listingParcel.trim().length > 0;
    const sizeOk = listingSize.trim().length > 0;
    const priceOk = normalizeKshPrice(listingPrice).trim().length > 0;
    if (!nameOk || !sizeOk || !priceOk) {
      setListingStepError("Fill in parcel name, size, and price to continue.");
      return false;
    }
    setListingStepError(null);
    return true;
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top,_#f9f1e6,_#f2ede4_55%,_#efe7d8)] text-[#14110f]">
      <header className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="text-left">
          <p className="text-xs uppercase tracking-[0.35em] text-[#c77d4b]">
            Vendor workspace
          </p>
          <h1 className="mt-2 font-serif text-2xl text-[#14110f] sm:text-3xl">
            Welcome back, {vendorProfile?.name ?? "Vendor"}.
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <button className="rounded-full border border-[#1f3d2d]/30 px-4 py-2 text-[#1f3d2d] transition hover:border-[#1f3d2d]">
            Export leads
          </button>
          <button
            className="rounded-full bg-[#1f3d2d] px-5 py-2 text-[#f7f3ea] transition hover:bg-[#173124]"
            onClick={() => setNewListingOpen(true)}
          >
            New listing
          </button>
          <button
            type="button"
            onClick={() => {
              window.location.href = "/";
            }}
            className="rounded-full border border-[#eadfce] px-4 py-2 text-[#5a4a44] transition hover:border-[#c9b8a6]"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 pb-24 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="space-y-6">
          <section className="rounded-3xl bg-[#fbf8f3] p-5 shadow-[0_20px_60px_-40px_rgba(20,17,15,0.5)]">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1f3d2d] text-lg font-semibold text-[#f4f1ea]">
                {(vendorProfile?.name ?? "AD")
                  .split(" ")
                  .slice(0, 2)
                  .map((part) => part[0]?.toUpperCase())
                  .join("")}
              </div>
              <div>
                <p className="text-sm font-semibold text-[#14110f]">
                  {vendorProfile?.name ?? "Vendor"}
                </p>
                <p className="text-xs text-[#5a4a44]">
                  {vendorProfile?.type ?? "Vendor"} ·{" "}
                  {vendorProfile?.location ?? "Western District"}
                </p>
              </div>
            </div>
            <div className="mt-6 space-y-3 text-xs">
              {[
                { label: "Active plots", value: String(plots.length) },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between rounded-2xl border border-[#eadfce] bg-white px-4 py-3"
                >
                  <span className="text-[#7a5f54]">{item.label}</span>
                  <span className="font-semibold text-[#14110f]">
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-[#eadfce] bg-white p-5 lg:block hidden">
          
            <div className="mt-4 space-y-3 text-sm font-medium">
              {[
                { id: "active", label: "Active listings" },
                { id: "drafts", label: "Drafts" },
                { id: "inquiries", label: "Inquiries" },
                { id: "pending", label: "Pending sales" },
                { id: "sales", label: "Sales" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() =>
                    setActiveTab(
                      tab.id as
                        | "active"
                        | "drafts"
                        | "inquiries"
                        | "pending"
                        | "sales"
                    )
                  }
                  className={`w-full rounded-2xl px-4 py-3 text-left transition ${
                    activeTab === tab.id
                      ? "bg-[#1f3d2d] text-white"
                      : "border border-[#eadfce] bg-white text-[#5a4a44]"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-[#eadfce] bg-white p-5 lg:block hidden">
            <p className="text-xs uppercase tracking-[0.35em] text-[#a67047]">
              Branding
            </p>
            <p className="mt-2 text-xs text-[#5a4a44]">
              Upload your logo for your vendor profile.
            </p>
            <div className="mt-3 space-y-3 text-xs">
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    if (typeof reader.result === "string") {
                      setVendorLogo(reader.result);
                    }
                  };
                  reader.readAsDataURL(file);
                }}
                className="text-xs text-[#5a4a44] file:mr-3 file:rounded-full file:border-0 file:bg-[#c77d4b] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
              />
              {vendorLogo ? (
                <div className="rounded-2xl border border-[#eadfce] bg-[#fbf8f3] px-3 py-2 text-[10px] text-[#6b3e1e]">
                  Logo uploaded
                </div>
              ) : (
                <div className="rounded-2xl border border-[#eadfce] bg-[#fbf8f3] px-3 py-2 text-[10px] text-[#6b3e1e]">
                  No logo yet
                </div>
              )}
            </div>
          </section>
        </aside>

        <section className="space-y-6">
          <div className="rounded-3xl border border-[#eadfce] bg-white p-5 min-h-[520px]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[#a67047]">
                  {activeTab === "active"
                    ? "My plots"
                    : activeTab === "drafts"
                    ? "Drafts"
                    : activeTab === "inquiries"
                    ? "Inquiries"
                    : activeTab === "pending"
                    ? "Pending sales"
                    : "Sales"}
                </p>
                <h2 className="mt-2 font-serif text-2xl text-[#14110f]">
                  {activeTab === "active"
                    ? "Active listings"
                    : activeTab === "drafts"
                    ? "Draft listings"
                    : activeTab === "inquiries"
                    ? "Latest inquiries"
                    : activeTab === "pending"
                    ? "Pending sales"
                    : "Sales records"}
                </h2>
              </div>
              <button className="rounded-full border border-[#1f3d2d]/30 px-4 py-2 text-xs font-medium text-[#1f3d2d] transition hover:border-[#1f3d2d]">
                View all
              </button>
            </div>

            <div className="mt-4 grid gap-3 rounded-2xl border border-[#eadfce] bg-[#fbf8f3] px-4 py-3 text-xs md:grid-cols-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.25em] text-[#a67047]">
                  Total posted value
                </p>
                <p className="mt-2 text-sm font-semibold text-[#14110f]">
                  ${totalPostedValue.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.25em] text-[#a67047]">
                  Existing value
                </p>
                <p className="mt-2 text-sm font-semibold text-[#14110f]">
                  ${totalExistingValue.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.25em] text-[#a67047]">
                  Sold value
                </p>
                <p className="mt-2 text-sm font-semibold text-[#14110f]">
                  ${totalSoldValue.toLocaleString()}
                </p>
              </div>
            </div>

            {activeTab === "active" && (
              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div className="order-2 space-y-3 text-sm lg:order-1">
                  {plots.map((plot) => {
                    const totalParcels = plot.totalParcels ?? 1;
                    const soldParcels = plot.soldParcelIds?.length ?? 0;
                    const availableParcels =
                      plot.availableParcels ?? totalParcels - soldParcels;
                    return (
                      <button
                        key={plot.id}
                        type="button"
                        onClick={() => {
                          setSelectedPlotId(plot.id);
                          setSelectedParcelIndex(null);
                        }}
                        className={`flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                          selectedPlotId === plot.id
                            ? "border-[#1f3d2d] bg-[#f7f2ea]"
                            : "border-[#eadfce] bg-[#fbf8f3]"
                        }`}
                      >
                        <div>
                          <p className="text-xs uppercase tracking-[0.3em] text-[#a67047]">
                            {plot.id}
                          </p>
                          <p className="mt-1 font-semibold text-[#14110f]">
                            {plot.name}
                          </p>
                          <p className="mt-1 text-xs text-[#5a4a44]">
                            {plot.acres} · {plot.price}
                          </p>
                          {totalParcels > 1 && (
                            <p className="mt-1 text-[11px] text-[#6b3e1e]">
                              Parcels: {availableParcels} available of{" "}
                              {totalParcels}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="rounded-full border border-[#1f3d2d]/30 bg-white px-3 py-1 text-[#1f3d2d]">
                            {plot.status}
                          </span>
                          <span className="rounded-full border border-[#eadfce] bg-white px-3 py-1 text-[#7a5f54]">
                            {plot.confidence} confidence
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="order-1 rounded-3xl border border-[#eadfce] bg-white p-4 text-xs lg:order-2">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-[#a67047]">
                    Details
                  </p>
                  {selectedPlot ? (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-semibold text-[#14110f]">
                        {selectedPlot.name}
                      </p>
                      <p className="text-[#5a4a44]">
                        {selectedPlot.acres} · {selectedPlot.price}
                      </p>
                      <p className="text-[#5a4a44]">
                        Status: {selectedPlot.status}
                      </p>
                      {selectedPlot.totalParcels && (
                        <p className="text-[#6b3e1e]">
                          Parcels:{" "}
                          {selectedPlot.availableParcels ??
                            selectedPlot.totalParcels -
                              (selectedPlot.soldParcelIds?.length ?? 0)}{" "}
                          available of {selectedPlot.totalParcels}
                        </p>
                      )}
                      {selectedPlot.totalParcels && (
                        <div className="space-y-2">
                          <p className="text-[11px] text-[#5a4a44]">
                            Select a parcel to mark as sold. Nodes are shared
                            across parcels.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {Array.from(
                              { length: selectedPlot.totalParcels },
                              (_, idx) => idx + 1
                            ).map((parcelNo) => {
                              const isSold =
                                selectedPlot.soldParcelIds?.includes(parcelNo);
                              const isSelected = selectedParcelIndex === parcelNo;
                              return (
                                <button
                                  key={parcelNo}
                                  type="button"
                                  onClick={() =>
                                    setSelectedParcelIndex(parcelNo)
                                  }
                                  disabled={isSold}
                                  className={`rounded-full px-3 py-1 text-[11px] transition ${
                                    isSold
                                      ? "cursor-not-allowed bg-[#eadfce] text-[#8a7a70]"
                                      : isSelected
                                      ? "bg-[#1f3d2d] text-white"
                                      : "border border-[#eadfce] bg-white text-[#5a4a44]"
                                  }`}
                                >
                                  Parcel {parcelNo}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          openSaleModal(selectedPlot.id, selectedParcelIndex)
                        }
                        className="mt-3 w-full rounded-full bg-[#1f3d2d] px-3 py-2 text-[11px] font-semibold text-white"
                        disabled={
                          selectedPlot.totalParcels && selectedPlot.totalParcels > 1
                            ? selectedParcelIndex === null
                            : false
                        }
                      >
                        Record sale
                      </button>
                    </div>
                  ) : (
                    <p className="mt-3 text-[#5a4a44]">
                      Select a listing to view details.
                    </p>
                  )}
                </div>
              </div>
            )}

            {activeTab === "drafts" && (
              <div className="mt-5 space-y-3 text-sm">
                {draftListings.map((draft) => (
                  <button
                    key={draft.id}
                    type="button"
                    onClick={async () => {
                      setListingParcel(draft.name);
                      setListingSize(draft.acres);
                      setListingPrice(draft.price);
                      setListingAmenities(draft.amenities);
                      setListingStep(draft.step);
                      setDraftId(draft.id);
                      setListingStepError(null);
                      if (vendorId) {
                        const snap = await getDoc(
                          doc(db, "draftListings", draft.id)
                        );
                        if (snap.exists()) {
                        const data = snap.data() as {
                          nodes?: {
                            label: string;
                            coords?: { lat: number; lng: number };
                            imageUrl?: string;
                          }[];
                        };
                        if (data.nodes?.length) {
                          setPanoramaNodes(
                            data.nodes.map((node, idx) => ({
                              id: Date.now() + idx,
                              label: node.label || `Node ${idx + 1}`,
                              files: null,
                              coords: node.coords ?? undefined,
                              imageUrl: node.imageUrl ?? "",
                            }))
                          );
                        }
                        }
                      }
                      setNewListingOpen(true);
                    }}
                    className="flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#eadfce] bg-[#fbf8f3] px-4 py-3 text-left transition hover:border-[#c9b8a6]"
                  >
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-[#a67047]">
                        {draft.id}
                      </p>
                      <p className="mt-1 font-semibold text-[#14110f]">
                        {draft.name}
                      </p>
                      <p className="mt-1 text-xs text-[#5a4a44]">
                        {draft.acres} · {draft.price}
                      </p>
                    </div>
                    <span className="rounded-full border border-[#eadfce] bg-white px-3 py-1 text-xs text-[#7a5f54]">
                      {draft.updated}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {activeTab === "inquiries" && (
              <div className="mt-5 space-y-3 text-sm">
                {inquiries.map((lead) => (
                  <button
                    key={lead.id}
                    type="button"
                    onClick={() => setSelectedInquiryId(lead.id)}
                    className={`flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                      selectedInquiryId === lead.id
                        ? "border-[#1f3d2d] bg-[#f7f2ea]"
                        : "border-[#eadfce] bg-[#fbf8f3]"
                    }`}
                  >
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-[#a67047]">
                        {lead.id}
                      </p>
                      <p className="mt-1 font-semibold text-[#14110f]">
                        {lead.buyer}
                      </p>
                      <p className="mt-1 text-xs text-[#5a4a44]">
                        {lead.parcel}
                      </p>
                    </div>
                    <div className="text-right text-xs">
                      <p className="text-[#1f3d2d]">{lead.intent} intent</p>
                      <p className="text-[#7a5f54]">{lead.time}</p>
                    </div>
                  </button>
                ))}
                <div className="rounded-2xl border border-[#eadfce] bg-white px-4 py-4 text-xs">
                  {selectedInquiryId ? (
                    (() => {
                      const inquiry = inquiries.find(
                        (item) => item.id === selectedInquiryId
                      );
                      if (!inquiry) return null;
                      return (
                        <div className="space-y-2">
                          <p className="text-[10px] uppercase tracking-[0.3em] text-[#a67047]">
                            Inquiry details
                          </p>
                          <p className="text-sm font-semibold text-[#14110f]">
                            {inquiry.buyer} · {inquiry.parcel}
                          </p>
                          <p className="text-[#5a4a44]">
                            Preferred contact: {inquiry.preferredContact}
                          </p>
                          <p className="text-[#5a4a44]">
                            Phone: {inquiry.phone}
                          </p>
                          <p className="rounded-2xl border border-[#eadfce] bg-[#fbf8f3] px-3 py-3 text-[11px] text-[#5a4a44]">
                            {inquiry.message}
                          </p>
                        </div>
                      );
                    })()
                  ) : (
                    <p className="text-[#5a4a44]">
                      Select an inquiry to view details.
                    </p>
                  )}
                </div>
              </div>
            )}

            {activeTab === "pending" && (
              <div className="mt-5 space-y-3 text-sm">
                {pendingSalesRecords.map((sale) => (
                  <div
                    key={sale.id}
                    className="rounded-2xl border border-[#eadfce] bg-[#fbf8f3] px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-[#a67047]">
                          {sale.id}
                        </p>
                        <p className="mt-1 font-semibold text-[#14110f]">
                          {sale.parcelName}
                        </p>
                        <p className="mt-1 text-xs text-[#5a4a44]">
                          Buyer: {sale.buyer}
                        </p>
                      </div>
                      <div className="text-right text-xs">
                        <p className="text-[#1f3d2d]">
                          ${sale.salePrice.toLocaleString()}
                        </p>
                        <p className="text-[#7a5f54]">{sale.soldOn}</p>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 text-[11px] text-[#5a4a44] sm:grid-cols-3">
                      <span>Net: ${sale.netToVendor.toLocaleString()}</span>
                      <span>Paid: ${sale.totalPaid.toLocaleString()}</span>
                      <span>
                        Remaining: ${sale.remainingBalance.toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <span className="text-[#7a5f54]">
                        Remaining balance: ${sale.remainingBalance.toLocaleString()}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedPendingId((current) =>
                            current === sale.id ? null : sale.id
                          )
                        }
                        className="rounded-full border border-[#1f3d2d]/30 bg-white px-3 py-1 text-[#1f3d2d]"
                      >
                        {expandedPendingId === sale.id
                          ? "Hide installments"
                          : "Update installments"}
                      </button>
                    </div>
                    <div className="mt-3 rounded-2xl border border-[#eadfce] bg-white px-3 py-3 text-[11px] text-[#5a4a44]">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] uppercase tracking-[0.25em] text-[#a67047]">
                          Installments recorded
                        </p>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full border border-[#eadfce] px-2 py-1 text-[9px] text-[#5a4a44]">
                            {sale.installments.length}
                          </span>
                          {installmentsOpenId === sale.id ? (
                            <button
                              type="button"
                              onClick={() => setInstallmentsOpenId(null)}
                              className="rounded-full border border-[#eadfce] px-2 py-1 text-[9px] text-[#5a4a44]"
                            >
                              Close
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setInstallmentsOpenId(sale.id)}
                              className="rounded-full border border-[#eadfce] px-2 py-1 text-[9px] text-[#5a4a44]"
                            >
                              View
                            </button>
                          )}
                        </div>
                      </div>
                      {installmentsOpenId === sale.id && (
                        <div className="mt-3 overflow-x-auto">
                        <table className="w-full text-left text-[11px]">
                          <thead className="text-[10px] uppercase tracking-[0.2em] text-[#a67047]">
                            <tr>
                              <th className="py-2 pr-3">Amount</th>
                              <th className="py-2 pr-3">Date</th>
                              <th className="py-2 pr-3">Method</th>
                              <th className="py-2">Proof</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sale.installments.map((installment) => (
                              <tr key={installment.id} className="border-t border-[#f0e5d6]">
                                <td className="py-2 pr-3">
                                  Ksh{" "}
                                  {Number(installment.amount || 0).toLocaleString()}
                                </td>
                                <td className="py-2 pr-3">
                                  {installment.date || "—"}
                                </td>
                                <td className="py-2 pr-3">{installment.method}</td>
                                <td className="py-2">
                                  {installment.proofUrl ? (
                                    <a
                                      href={installment.proofUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex rounded-full border border-[#eadfce] px-2 py-1 text-[10px] text-[#1f3d2d]"
                                      title={installment.proofName || "View proof"}
                                    >
                                      View
                                    </a>
                                  ) : (
                                    <span className="text-[#8a7a70]">—</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        </div>
                      )}
                    </div>
                    {expandedPendingId === sale.id && (
                      <div className="mt-3 rounded-2xl border border-[#eadfce] bg-white px-3 py-3 text-[11px] text-[#5a4a44]">
                        <p className="text-[10px] uppercase tracking-[0.25em] text-[#a67047]">
                          Add / update installments
                        </p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_140px]">
                          <input
                            type="number"
                            value={installmentDrafts[sale.id]?.amount ?? ""}
                            onChange={(event) =>
                              setInstallmentDrafts((current) => ({
                                ...current,
                                [sale.id]: {
                                  amount: event.target.value,
                                  date: current[sale.id]?.date ?? "",
                                  method:
                                    current[sale.id]?.method ?? "Mobile money",
                                  proofFile: current[sale.id]?.proofFile ?? null,
                                },
                              }))
                            }
                            placeholder="Amount paid"
                            className="rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                          />
                          <input
                            type="date"
                            value={installmentDrafts[sale.id]?.date ?? ""}
                            onChange={(event) =>
                              setInstallmentDrafts((current) => ({
                                ...current,
                                [sale.id]: {
                                  amount: current[sale.id]?.amount ?? "",
                                  date: event.target.value,
                                  method:
                                    current[sale.id]?.method ?? "Mobile money",
                                  proofFile: current[sale.id]?.proofFile ?? null,
                                },
                              }))
                            }
                            className="rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                          />
                          <select
                            value={installmentDrafts[sale.id]?.method ?? "Mobile money"}
                            onChange={(event) =>
                              setInstallmentDrafts((current) => ({
                                ...current,
                                [sale.id]: {
                                  amount: current[sale.id]?.amount ?? "",
                                  date: current[sale.id]?.date ?? "",
                                  method: event.target.value as
                                    | "Cash"
                                    | "Bank transfer"
                                    | "Mobile money",
                                  proofFile: current[sale.id]?.proofFile ?? null,
                                },
                              }))
                            }
                            className="rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                          >
                            <option value="Mobile money">Mobile money</option>
                            <option value="Bank transfer">Bank transfer</option>
                            <option value="Cash">Cash</option>
                          </select>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <input
                            type="file"
                            accept="application/pdf,image/*"
                            onChange={(event) =>
                              setInstallmentDrafts((current) => ({
                                ...current,
                                [sale.id]: {
                                  amount: current[sale.id]?.amount ?? "",
                                  date: current[sale.id]?.date ?? "",
                                  method:
                                    current[sale.id]?.method ?? "Mobile money",
                                  proofFile: event.target.files?.[0] ?? null,
                                },
                              }))
                            }
                            className="text-xs text-[#5a4a44] file:mr-3 file:rounded-full file:border-0 file:bg-[#c77d4b] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
                          />
                          {installmentDrafts[sale.id]?.proofFile ? (
                            <span className="rounded-full border border-[#eadfce] px-3 py-1 text-[10px] text-[#6b3e1e]">
                              {installmentDrafts[sale.id]?.proofFile?.name}
                            </span>
                          ) : (
                            <span className="text-[10px] text-[#7a6a63]">
                              Optional payment proof
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => submitPendingInstallment(sale.id)}
                          className="mt-3 rounded-full bg-[#1f3d2d] px-3 py-2 text-[11px] font-semibold text-white"
                          disabled={installmentDrafts[sale.id]?.saving}
                        >
                          {installmentDrafts[sale.id]?.saving
                            ? "Saving..."
                            : "Add installment"}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {activeTab === "sales" && (
              <div className="mt-5 space-y-3 text-sm">
                {salesRecords.map((sale) => (
                  <div
                    key={sale.id}
                    className="rounded-2xl border border-[#eadfce] bg-[#fbf8f3] px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-[#a67047]">
                          {sale.id}
                        </p>
                        <p className="mt-1 font-semibold text-[#14110f]">
                          {sale.parcelName}
                        </p>
                        <p className="mt-1 text-xs text-[#5a4a44]">
                          Buyer: {sale.buyer}
                        </p>
                      </div>
                      <div className="text-right text-xs">
                        <p className="text-[#1f3d2d]">
                          ${sale.salePrice.toLocaleString()}
                        </p>
                        <p className="text-[#7a5f54]">{sale.soldOn}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between text-[11px] text-[#5a4a44]">
                      <span>Fee: ${sale.processingFee.toLocaleString()}</span>
                      <span>Net: ${sale.netToVendor.toLocaleString()}</span>
                    </div>
                    <div className="mt-3 rounded-2xl border border-[#eadfce] bg-white px-3 py-3 text-[11px] text-[#5a4a44]">
                      <p className="text-[10px] uppercase tracking-[0.25em] text-[#a67047]">
                        Signed agreement
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input
                          type="file"
                          accept="application/pdf,image/*"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            setSalesRecords((current) =>
                              current.map((item) =>
                                item.id === sale.id
                                  ? { ...item, agreementFile: file.name }
                                  : item
                              )
                            );
                          }}
                          className="text-xs text-[#5a4a44] file:mr-3 file:rounded-full file:border-0 file:bg-[#c77d4b] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
                        />
                        {sale.agreementFile ? (
                          <span className="rounded-full border border-[#eadfce] px-3 py-1 text-[10px] text-[#6b3e1e]">
                            {sale.agreementFile}
                          </span>
                        ) : (
                          <span className="text-[10px] text-[#7a6a63]">
                            Upload signed advocate agreement
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

          </div>

        </section>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[#eadfce] bg-white/90 px-4 py-3 text-xs backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-2">
            {[
              { id: "active", label: "Active" },
              { id: "drafts", label: "Drafts" },
              { id: "inquiries", label: "Inquiries" },
              { id: "pending", label: "Pending" },
              { id: "sales", label: "Sales" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() =>
                  setActiveTab(
                    tab.id as
                      | "active"
                      | "drafts"
                      | "inquiries"
                      | "pending"
                      | "sales"
                  )
                }
              className={`flex-1 rounded-full px-3 py-2 text-xs transition ${
                activeTab === tab.id
                  ? "bg-[#1f3d2d] text-white"
                  : "border border-[#eadfce] bg-white text-[#5a4a44]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {saleModalOpen && saleDraft && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl border border-[#eadfce] bg-[#fbf8f3] p-6 shadow-[0_30px_70px_-40px_rgba(20,17,15,0.6)]">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-[#a67047]">
                  Record sale
                </p>
                <p className="mt-2 font-serif text-xl text-[#14110f]">
                  {saleDraft.parcelName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSaleModalOpen(false)}
                className="rounded-full border border-[#eadfce] px-3 py-1 text-xs text-[#5a4a44]"
              >
                Close
              </button>
            </div>

            <div className="mt-5 space-y-4 text-xs">
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-[#a67047]">
                  Buyer name
                </label>
                <input
                  type="text"
                  value={buyerNameInput}
                  onChange={(event) => setBuyerNameInput(event.target.value)}
                  placeholder="Buyer or company name"
                  className="mt-2 w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="text-[10px] uppercase tracking-[0.25em] text-[#a67047]">
                    Selling price
                  </label>
                  <input
                    type="number"
                    value={salePriceInput}
                    onChange={(event) => setSalePriceInput(event.target.value)}
                    placeholder="e.g. 48000"
                    className="mt-2 w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-[#a67047]">
                  Sale type
                </label>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  {[
                    { id: "cash", label: "Cash sale" },
                    { id: "installments", label: "Installments" },
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() =>
                        setSaleType(option.id as "cash" | "installments")
                      }
                      className={`rounded-full px-3 py-1 text-[11px] transition ${
                        saleType === option.id
                          ? "bg-[#1f3d2d] text-white"
                          : "border border-[#eadfce] bg-white text-[#5a4a44]"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-[#a67047]">
                  Charges & expenses
                </label>
                <div className="mt-2 space-y-2">
                  {charges.map((charge) => (
                    <div
                      key={charge.id}
                      className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_130px_auto]"
                    >
                      <input
                        type="text"
                        value={charge.label}
                        onChange={(event) =>
                          setCharges((current) =>
                            current.map((item) =>
                              item.id === charge.id
                                ? { ...item, label: event.target.value }
                                : item
                            )
                          )
                        }
                        placeholder="Charge name"
                        className="rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                      />
                      <input
                        type="number"
                        value={charge.amount}
                        onChange={(event) =>
                          setCharges((current) =>
                            current.map((item) =>
                              item.id === charge.id
                                ? { ...item, amount: event.target.value }
                                : item
                            )
                          )
                        }
                        placeholder="Amount"
                        className="rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                      />
                      <select
                        value={charge.kind}
                        onChange={(event) =>
                          setCharges((current) =>
                            current.map((item) =>
                              item.id === charge.id
                                ? {
                                    ...item,
                                    kind: event.target.value as
                                      | "charge"
                                      | "expense",
                                  }
                                : item
                            )
                          )
                        }
                        className="rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                      >
                        <option value="charge">Charge</option>
                        <option value="expense">Expense</option>
                      </select>
                      <button
                        type="button"
                        onClick={() =>
                          setCharges((current) =>
                            current.length === 1
                              ? current
                              : current.filter((item) => item.id !== charge.id)
                          )
                        }
                        className="rounded-full border border-[#eadfce] px-3 py-2 text-xs text-[#5a4a44]"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setCharges((current) => [
                      ...current,
                      { id: Date.now(), label: "", amount: "", kind: "charge" },
                    ])
                  }
                  className="mt-3 rounded-full border border-[#eadfce] px-3 py-2 text-xs text-[#5a4a44]"
                >
                  Add item
                </button>
              </div>
              {saleType === "installments" && (
                <div>
                  <label className="text-[10px] uppercase tracking-[0.25em] text-[#a67047]">
                    Installments
                  </label>
                  {installments.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {installments.map((installment) => (
                        <div
                          key={installment.id}
                          className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_140px_auto]"
                        >
                          <input
                            type="number"
                            value={installment.amount}
                            onChange={(event) =>
                              setInstallments((current) =>
                                current.map((item) =>
                                  item.id === installment.id
                                    ? { ...item, amount: event.target.value }
                                    : item
                                )
                              )
                            }
                            placeholder="Amount paid"
                            className="rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                          />
                          <input
                            type="date"
                            value={installment.date}
                            onChange={(event) =>
                              setInstallments((current) =>
                                current.map((item) =>
                                  item.id === installment.id
                                    ? { ...item, date: event.target.value }
                                    : item
                                )
                              )
                            }
                            className="rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                          />
                          <select
                            value={installment.method}
                            onChange={(event) =>
                              setInstallments((current) =>
                                current.map((item) =>
                                  item.id === installment.id
                                    ? {
                                        ...item,
                                        method: event.target.value as
                                          | "Cash"
                                          | "Bank transfer"
                                          | "Mobile money",
                                      }
                                    : item
                                )
                              )
                            }
                            className="rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                          >
                            <option value="Mobile money">Mobile money</option>
                            <option value="Bank transfer">Bank transfer</option>
                            <option value="Cash">Cash</option>
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              setInstallments((current) =>
                                current.filter((item) => item.id !== installment.id)
                              )
                            }
                            className="rounded-full border border-[#eadfce] px-3 py-2 text-xs text-[#5a4a44]"
                          >
                            Remove
                          </button>
                          <div className="sm:col-span-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="file"
                                accept="application/pdf,image/*"
                                onChange={(event) => {
                                  const file = event.target.files?.[0];
                                  setInstallments((current) =>
                                    current.map((item) =>
                                      item.id === installment.id
                                        ? {
                                            ...item,
                                            proofName: file ? file.name : "",
                                          }
                                        : item
                                    )
                                  );
                                }}
                                className="text-xs text-[#5a4a44] file:mr-3 file:rounded-full file:border-0 file:bg-[#c77d4b] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
                              />
                              {installment.proofName ? (
                                <span className="rounded-full border border-[#eadfce] px-3 py-1 text-[10px] text-[#6b3e1e]">
                                  {installment.proofName}
                                </span>
                              ) : (
                                <span className="text-[10px] text-[#7a6a63]">
                                  Optional payment proof
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setInstallments((current) => [
                        ...current,
                        {
                          id: Date.now(),
                          amount: "",
                          date: "",
                          method: "Mobile money",
                          proofName: "",
                        },
                      ])
                    }
                    className="mt-3 rounded-full border border-[#eadfce] px-3 py-2 text-xs text-[#5a4a44]"
                  >
                    Add installment
                  </button>
                </div>
              )}
              <div className="rounded-2xl border border-[#eadfce] bg-white px-4 py-3 text-[11px] text-[#5a4a44]">
                <p>
                  Net to vendor: $
                  {Math.max(
                    (Number(salePriceInput) || 0) -
                      charges.reduce((sum, charge) => {
                        const fee = Number(charge.amount) || 0;
                        return sum + fee;
                      }, 0),
                    0
                  ).toLocaleString()}
                </p>
                <p className="mt-1">
                  Total paid: $
                  {(saleType === "cash"
                    ? Math.max(
                        (Number(salePriceInput) || 0) -
                          charges.reduce((sum, charge) => {
                            const fee = Number(charge.amount) || 0;
                            return sum + fee;
                          }, 0),
                        0
                      )
                    : installments.reduce((sum, installment) => {
                        const paid = Number(installment.amount) || 0;
                        return sum + paid;
                      }, 0)
                  ).toLocaleString()}
                </p>
                <p className="mt-1">
                  Remaining balance: $
                  {Math.max(
                    Math.max(
                      (Number(salePriceInput) || 0) -
                        charges.reduce((sum, charge) => {
                          const fee = Number(charge.amount) || 0;
                          return sum + fee;
                        }, 0),
                      0
                    ) -
                      (saleType === "cash"
                        ? Math.max(
                            (Number(salePriceInput) || 0) -
                              charges.reduce((sum, charge) => {
                                const fee = Number(charge.amount) || 0;
                                return sum + fee;
                              }, 0),
                            0
                          )
                        : installments.reduce((sum, installment) => {
                            const paid = Number(installment.amount) || 0;
                            return sum + paid;
                          }, 0)),
                    0
                  ).toLocaleString()}
                </p>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setSaleModalOpen(false)}
                className="rounded-full border border-[#eadfce] px-4 py-2 text-xs text-[#5a4a44]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmSale}
                className="rounded-full bg-[#1f3d2d] px-4 py-2 text-xs font-semibold text-white"
              >
                Record sale
              </button>
            </div>
          </div>
        </div>
      )}

      {newListingOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border border-[#eadfce] bg-[#fbf8f3] p-6 shadow-[0_30px_70px_-40px_rgba(20,17,15,0.6)]">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-[#a67047]">
                  New listing
                </p>
                <p className="mt-2 font-serif text-2xl text-[#14110f]">
                  Capture a parcel
                </p>
                <p className="mt-2 text-xs text-[#5a4a44]">
                  Step {listingStep} of 3
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNewListingOpen(false)}
                className="rounded-full border border-[#eadfce] px-3 py-1 text-xs text-[#5a4a44]"
              >
                Close
              </button>
            </div>

            {listingStep === 1 && (
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-[10px] uppercase tracking-[0.25em] text-[#a67047]">
                    Parcel name
                  </label>
                  <input
                    type="text"
                    value={listingParcel}
                    onChange={(event) => {
                      setListingParcel(event.target.value);
                      setListingStepError(null);
                    }}
                    placeholder="Plot name"
                    className="mt-2 w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.25em] text-[#a67047]">
                    Parcel size
                  </label>
                  <input
                    type="text"
                    value={listingSize}
                    onChange={(event) => {
                      setListingSize(event.target.value);
                      setListingStepError(null);
                    }}
                    placeholder="e.g. 2.6 acres"
                    className="mt-2 w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.25em] text-[#a67047]">
                    Price
                  </label>
                  <input
                    type="text"
                    value={listingPrice}
                    onChange={(event) => {
                      setListingPrice(formatKshInput(event.target.value));
                      setListingStepError(null);
                    }}
                    placeholder="e.g. Ksh 48k"
                    className="mt-2 w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                  />
                </div>
                {listingStepError && (
                  <div className="rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-[11px] text-[#b3261e] md:col-span-2">
                    {listingStepError}
                  </div>
                )}
                <div className="md:col-span-2">
                  <label className="text-[10px] uppercase tracking-[0.25em] text-[#a67047]">
                    Amenities
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {[
                      'Access road',
                      'Power',
                      'Water',
                      'Well water',
                      'Mobile coverage',
                      'River access',
                    ].map((amenity) => {
                      const isActive = listingAmenities.includes(amenity);
                      return (
                        <button
                          key={amenity}
                          type="button"
                          onClick={() =>
                            setListingAmenities((current) =>
                              isActive
                                ? current.filter((item) => item !== amenity)
                                : [...current, amenity]
                            )
                          }
                          className={`rounded-full px-3 py-1 text-xs transition ${
                            isActive
                              ? 'bg-[#c77d4b] text-white'
                              : 'border border-[#eadfce] bg-white text-[#6b3e1e]'
                          }`}
                        >
                          {amenity}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {listingStep === 2 && (
              <div className="mt-6 space-y-5 text-xs text-[#3a2f2a]">
                <div className="rounded-2xl border border-[#eadfce] bg-white px-4 py-4">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-[#a67047]">
                    Street view instructions
                  </p>
                  <p className="mt-2 text-xs">
                    Capture flat photos at equal distances along the path.
                  </p>
                  <p className="mt-2 text-xs">
                    Keep the camera level and facing forward for a smooth tour.
                  </p>
                  <p className="mt-2 text-xs">
                    Upload each node photo below to build the preview.
                  </p>
                </div>
                <div className="space-y-3">
                  {panoramaNodes.map((node) => (
                    <div
                      key={node.id}
                      className="rounded-2xl border border-[#eadfce] bg-white px-4 py-3"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-[#14110f]">
                          {node.label}
                        </p>
                        {panoramaNodes.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setPanoramaNodes((current) =>
                                current.filter((item) => item.id !== node.id)
                              )
                            }
                            className="rounded-full border border-[#eadfce] px-2 py-1 text-[10px] text-[#5a4a44]"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(event) => {
                            const files = event.target.files;
                            setStreetPreviewError(null);
                            setPanoramaNodes((current) =>
                              current.map((item) =>
                                item.id === node.id
                                  ? { ...item, files }
                                  : item
                              )
                            );
                            const file = files?.[0];
                            const activeVendorId = getActiveVendorId();
                            if (file && activeVendorId) {
                              const fileRef = ref(
                                storage,
                                `vendors/${activeVendorId}/nodes/${node.id}-${file.name}`
                              );
                              uploadBytes(fileRef, file).then(() =>
                                getDownloadURL(fileRef).then((url) => {
                                  setPanoramaNodes((current) =>
                                    current.map((item) =>
                                      item.id === node.id
                                        ? { ...item, imageUrl: url }
                                        : item
                                    )
                                  );
                                })
                              );
                            }
                            if (navigator.geolocation) {
                              navigator.geolocation.getCurrentPosition(
                                (pos) => {
                                  setPanoramaNodes((current) =>
                                    current.map((item) =>
                                      item.id === node.id
                                        ? {
                                            ...item,
                                            coords: {
                                              lat: pos.coords.latitude,
                                              lng: pos.coords.longitude,
                                            },
                                          }
                                        : item
                                    )
                                  );
                                },
                                () => {
                                  setLocationStatus(
                                    "Unable to capture node location."
                                  );
                                },
                                { enableHighAccuracy: true, timeout: 10000 }
                              );
                            }
                          }}
                          className="w-full text-xs text-[#5a4a44] file:mr-3 file:rounded-full file:border-0 file:bg-[#c77d4b] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
                        />
                      </div>
                      {node.files?.length ? (
                        <p className="mt-2 text-[10px] text-[#6b3e1e]">
                          {node.files.length} file(s) selected
                          {node.coords
                            ? ` · ${node.coords.lat.toFixed(
                                5
                              )}, ${node.coords.lng.toFixed(5)}`
                            : ""}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() =>
                      setPanoramaNodes((current) => [
                        ...current,
                        {
                          id: Date.now(),
                          label: `Node ${current.length + 1}`,
                          files: null,
                          coords: undefined,
                        },
                      ])
                    }
                    className="rounded-full border border-[#eadfce] px-3 py-2 text-xs text-[#5a4a44]"
                  >
                    Add another node
                  </button>
                  <span className="text-[10px] text-[#6b3e1e]">
                    Add as many nodes as needed for a smooth preview.
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={openStreetPreview}
                    className="rounded-full bg-[#1f3d2d] px-4 py-2 text-xs font-semibold text-white"
                  >
                    Complete node collection
                  </button>
                  {streetPreviewError ? (
                    <span className="text-[10px] text-[#b3261e]">
                      {streetPreviewError}
                    </span>
                  ) : (
                    <span className="text-[10px] text-[#6b3e1e]">
                      Build a street preview from your captured nodes.
                    </span>
                  )}
                </div>
                {streetPreviewOpen && previewNodes.length > 0 && (
                  <div className="rounded-2xl border border-[#eadfce] bg-white px-4 py-4">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] uppercase tracking-[0.3em] text-[#a67047]">
                        Street view preview
                      </p>
                      <button
                        type="button"
                        onClick={() => setStreetPreviewOpen(false)}
                        className="rounded-full border border-[#eadfce] px-3 py-1 text-[10px] text-[#5a4a44]"
                      >
                        Close
                      </button>
                    </div>
                    <div className="relative mt-4 overflow-hidden rounded-2xl border border-[#eadfce] bg-[#fbf8f3] perspective-1000">
                      {streetPreviewPrevIndex !== null && (
                        <div
                          key={`street-prev-${streetPreviewPrevIndex}`}
                          className={`absolute inset-0 bg-cover bg-center transition-opacity duration-300 ease-out street-pan-3d ${
                            streetPreviewAnimating ? "opacity-0" : "opacity-100"
                          } street-swipe-out`}
                          style={{
                            backgroundImage: `url(${previewNodes[streetPreviewPrevIndex]?.imageUrl})`,
                            backgroundSize: "130% 100%",
                            backgroundPosition: `${streetPanValue}% 50%`,
                            transform: `translateX(${(50 - streetPanValue) * 0.04}%) rotateY(${(streetPanValue - 50) * 0.08}deg)`,
                          }}
                        />
                      )}
                      <div
                        key={`street-current-${streetPreviewIndex}`}
                        className={`relative h-64 w-full bg-cover bg-center transition-all duration-300 ease-out street-pan street-pan-3d street-swipe-in ${
                          streetPreviewAnimating
                            ? "scale-[1.02] opacity-90"
                            : "scale-100 opacity-100"
                        }`}
                        style={{
                          backgroundImage: `url(${previewNodes[streetPreviewIndex]?.imageUrl})`,
                          backgroundSize: "130% 100%",
                          backgroundPosition: `${streetPanValue}% 50%`,
                          transform: `translateX(${(50 - streetPanValue) * 0.04}%) rotateY(${(streetPanValue - 50) * 0.08}deg)`,
                        }}
                        onDoubleClick={handlePreviewAdvance}
                        onTouchEnd={handlePreviewTouch}
                        role="button"
                        tabIndex={0}
                        aria-label="Advance to next street view node"
                      />
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between px-4 py-3 text-[10px] text-white">
                        <span className="rounded-full bg-black/40 px-2 py-1">
                          Node {streetPreviewIndex + 1} of{" "}
                          {previewNodes.length}
                        </span>
                        <span className="rounded-full bg-black/40 px-2 py-1">
                          Double tap to advance
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <span className="rounded-full border border-[#eadfce] bg-white px-3 py-1 text-[10px] text-[#5a4a44]">
                        Pan
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={streetPanValue}
                        onChange={(event) =>
                          setStreetPanValue(Number(event.target.value))
                        }
                        className="w-full accent-[#1f3d2d]"
                      />
                    </div>
                    <style jsx>{`
                      .perspective-1000 {
                        perspective: 1000px;
                      }
                      .street-pan-3d {
                        transform-style: preserve-3d;
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
                )}
              </div>
            )}

            {listingStep === 3 && (
              <div className="mt-6 space-y-4 text-xs text-[#3a2f2a]">
                <div className="rounded-2xl border border-[#eadfce] bg-white px-4 py-4">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-[#a67047]">
                    Multiple parcels
                  </p>
                  <p className="mt-2 text-xs">
                    If this land was subdivided, add each parcel name before
                    mapping.
                  </p>
                  <div className="mt-3 space-y-2">
                    {subParcels.map((parcel, index) => (
                      <div
                        key={parcel.id}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="text"
                          value={parcel.name}
                          onChange={(event) =>
                            setSubParcels((current) =>
                              current.map((item) =>
                                item.id === parcel.id
                                  ? { ...item, name: event.target.value }
                                  : item
                              )
                            )
                          }
                          placeholder={`Parcel ${index + 1} name`}
                          className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-xs text-[#14110f]"
                        />
                        {subParcels.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setSubParcels((current) =>
                                current.filter((item) => item.id !== parcel.id)
                              )
                            }
                            className="rounded-full border border-[#eadfce] px-3 py-2 text-[10px] text-[#5a4a44]"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setSubParcels((current) => [
                        ...current,
                        {
                          id: Date.now(),
                          name: `Parcel ${current.length + 1}`,
                          mappingActive: false,
                          previewOpen: false,
                          rawPath: [],
                          cleanPath: [],
                          gpsAccuracy: undefined,
                          waitingForFix: false,
                          hasGoodFix: false,
                        },
                      ])
                    }
                    className="mt-3 rounded-full border border-[#eadfce] px-3 py-2 text-xs text-[#5a4a44]"
                  >
                    Add another parcel
                  </button>
                </div>
                <div className="rounded-2xl border border-[#eadfce] bg-white px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.3em] text-[#a67047]">
                        Map preview
                      </p>
                      <p className="mt-2 text-xs text-[#5a4a44]">
                        Preview and adjust parcel positions on the map.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMapPreviewOpen(true)}
                      className="rounded-full bg-[#1f3d2d] px-4 py-2 text-xs font-semibold text-white"
                    >
                      Open map preview
                    </button>
                  </div>
                </div>
                <div className="rounded-2xl border border-[#eadfce] bg-white px-4 py-4">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-[#a67047]">
                    Mapping instructions
                  </p>
                  <ul className="mt-3 space-y-2 text-xs">
                    <li>
                      Stand at the nearest recognizable beacon or plot corner and tap
                      "Start mapping".
                    </li>
                    <li>
                      Wait until GPS accuracy reads within 1-3m before moving.
                    </li>
                    <li>
                      Walk the full perimeter of the parcel. Keep your phone
                      facing forward.
                    </li>
                    <li>
                      Tap "Stop" when you return to your starting point or when
                      the loop closes.
                    </li>
                    <li>
                      Review the boundary. If it looks wrong, recapture.
                    </li>
                  </ul>
                  {locationStatus && (
                    <p className="mt-3 text-[11px] text-[#6b3e1e]">
                      {locationStatus}
                    </p>
                  )}
                </div>
                <div className="space-y-3">
                  {subParcels.map((parcel) => (
                    <div
                      key={parcel.id}
                      className="rounded-2xl border border-[#eadfce] bg-white px-4 py-4"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-[#14110f]">
                          {parcel.name || "Untitled parcel"}
                        </p>
                        <span className="rounded-full border border-[#eadfce] px-2 py-1 text-[10px] text-[#5a4a44]">
                          Mapping
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span
                            className={`inline-flex h-3 w-3 rounded-full ${
                              parcel.mappingActive
                                ? "animate-pulse bg-[#c77d4b]"
                                : "bg-[#eadfce]"
                            }`}
                          />
                          <p className="text-xs text-[#5a4a44]">
                            {parcel.mappingActive
                              ? "Mapping in progress..."
                              : "Not mapping"}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSubParcels((current) =>
                                current.map((item) =>
                                  item.id === parcel.id
                                    ? {
                                        ...item,
                                        mappingActive: true,
                                        previewOpen: true,
                                        rawPath: [],
                                        cleanPath: [],
                                        waitingForFix: true,
                                        hasGoodFix: false,
                                      }
                                    : item
                                )
                              );
                              startGpsCapture(parcel.id);
                            }}
                            className="rounded-full bg-[#1f3d2d] px-4 py-2 text-xs font-semibold text-white"
                          >
                            Start mapping
                          </button>
                          <button
                            type="button"
                            onClick={() => stopGpsCapture(parcel.id)}
                            className="rounded-full border border-[#1f3d2d]/30 px-4 py-2 text-xs font-semibold text-[#1f3d2d]"
                          >
                            Stop
                          </button>
                        </div>
                      </div>
                      {parcel.previewOpen && (
                        <div className="mt-4 rounded-2xl border border-[#eadfce] bg-[#fbf8f3] px-4 py-4">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="text-[10px] uppercase tracking-[0.3em] text-[#a67047]">
                                Mapping preview
                              </p>
                              <p className="mt-2 text-xs text-[#5a4a44]">
                                Review the captured boundary before finishing.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setSubParcels((current) =>
                                  current.map((item) =>
                                    item.id === parcel.id
                                      ? { ...item, previewOpen: false }
                                      : item
                                  )
                                )
                              }
                              className="rounded-full border border-[#eadfce] px-3 py-1 text-[10px] text-[#5a4a44]"
                            >
                              Hide
                            </button>
                          </div>
                          <div className="mt-4 rounded-2xl border border-dashed border-[#eadfce] bg-white p-3">
                            <svg
                              width="100%"
                              height="140"
                              viewBox="0 0 240 140"
                              className="w-full"
                            >
                              <path
                                d={buildSvgPath(parcel.rawPath, 240, 140)}
                                fill="none"
                                stroke="#d8c7b6"
                                strokeWidth="2"
                                strokeDasharray="4 4"
                              />
                              <path
                                d={buildSvgPath(parcel.cleanPath, 240, 140)}
                                fill="none"
                                stroke="#1f3d2d"
                                strokeWidth="3"
                              />
                            </svg>
                          </div>
                          <div className="mt-4 flex flex-wrap items-center justify-between text-[11px] text-[#5a4a44]">
                            <span>
                              Raw points: {parcel.rawPath.length} · Corners:{" "}
                              {parcel.cleanPath.length}
                            </span>
                            <span>
                              Perimeter:{" "}
                              {(
                                pathLength(parcel.cleanPath) / 1000
                              ).toFixed(2)}{" "}
                              km (est.)
                            </span>
                          </div>
                          {parcel.mappingActive && (
                            <div className="mt-3 flex flex-wrap items-center justify-between text-[10px] text-[#6b3e1e]">
                              <span>
                                Live capture{" "}
                                {parcel.waitingForFix
                                  ? `(waiting for ≤${minGpsAccuracyMeters}m)`
                                  : "(tracking)"}
                              </span>
                              {parcel.gpsAccuracy ? (
                                <span>±{Math.round(parcel.gpsAccuracy)}m</span>
                              ) : null}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {listingStep > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setListingStep((step) =>
                        step === 2 ? 1 : (step - 1) as 1 | 2 | 3
                      )
                    }
                    className="rounded-full border border-[#eadfce] px-4 py-2 text-xs text-[#5a4a44]"
                  >
                    Back
                  </button>
                )}
              </div>
              <div className="flex flex-col items-end gap-2 text-[10px] text-[#6b3e1e]">
                {listingStep < 3 ? (
                  <>
                    <span>Saved as draft. You can finish later.</span>
                  <button
                    type="button"
                    onClick={async () => {
                      if (listingStep === 1 && !validateListingStepOne()) {
                        return;
                      }
                      const nextStep = (listingStep === 1 ? 2 : 3) as 1 | 2 | 3;
                      await saveDraftStep(nextStep);
                      setListingStep(nextStep);
                    }}
                    className="rounded-full bg-[#c77d4b] px-4 py-2 text-xs font-semibold text-white"
                    disabled={draftSaving}
                  >
                    {draftSaving ? "Saving..." : "Next"}
                  </button>
                  </>
                ) : (
                  <>
                    <span>Saved as draft. You can submit later.</span>
                  <button
                    type="button"
                    onClick={finishListing}
                    className="rounded-full bg-[#c77d4b] px-4 py-2 text-xs font-semibold text-white"
                    disabled={draftSaving}
                  >
                    {draftSaving ? "Saving..." : "Finish"}
                  </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {mapPreviewOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-3xl border border-[#eadfce] bg-[#fbf8f3] p-6 shadow-[0_30px_70px_-40px_rgba(20,17,15,0.6)]">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-[#a67047]">
                  Parcel map preview
                </p>
                <p className="mt-2 text-lg font-semibold text-[#14110f]">
                  Adjust parcel positions
                </p>
                <p className="mt-1 text-xs text-[#5a4a44]">
                  Drag any parcel boundary to reposition it on the map.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMapPreviewOpen(false)}
                className="rounded-full border border-[#eadfce] px-3 py-1 text-xs text-[#5a4a44]"
              >
                Close
              </button>
            </div>
            <div className="mt-4 overflow-hidden rounded-3xl border border-[#eadfce] bg-white">
              <div ref={mapPreviewRef} className="h-[420px] w-full" />
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-[#5a4a44]">
              <span>Tip: Click and drag a parcel to nudge its position.</span>
              <button
                type="button"
                onClick={() => setMapPreviewOpen(false)}
                className="rounded-full bg-[#1f3d2d] px-4 py-2 text-xs font-semibold text-white"
              >
                Save positions
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
