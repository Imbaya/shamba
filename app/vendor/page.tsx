"use client";

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
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

const initialPlots: VendorPlot[] = [
  {
    id: "PT-204",
    name: "Redwood Ridge",
    status: "Listed",
    acres: "2.6 acres",
    price: "$48k",
    confidence: "93%",
    totalParcels: 5,
    soldParcelIds: [1, 3],
  },
  {
    id: "PT-311",
    name: "Blue River Bend",
    status: "Awaiting review",
    acres: "1.2 acres",
    price: "$26k",
    confidence: "86%",
    totalParcels: 1,
    soldParcelIds: [],
  },
  {
    id: "PT-517",
    name: "Koru Valley",
    status: "Needs recapture",
    acres: "5.1 acres",
    price: "$71k",
    confidence: "72%",
    totalParcels: 3,
    soldParcelIds: [2],
  },
  {
    id: "PT-642",
    name: "Mango Grove",
    status: "Awaiting review",
    acres: "1.8 acres",
    price: "$34k",
    confidence: "89%",
    totalParcels: 1,
    soldParcelIds: [],
  },
];

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

const initialSoldListings: SoldListing[] = [
  {
    id: "SLD-204",
    name: "Cedar Flats",
    acres: "2.1 acres",
    price: "$45k",
    soldOn: "Sold Feb 2, 2026",
  },
  {
    id: "SLD-233",
    name: "Olive Ridge",
    acres: "1.6 acres",
    price: "$33k",
    soldOn: "Sold Jan 18, 2026",
  },
];

type SaleInstallment = {
  id: number;
  amount: string;
  date: string;
  method: "Cash" | "Bank transfer" | "Mobile money";
  proofName?: string;
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

const initialPendingSales: SalesRecord[] = [
  {
    id: "SALE-1021",
    parcelName: "Cedar Flats",
    parcelId: "SLD-204",
    buyer: "K. Kamau",
    salePrice: 45000,
    processingFee: 1200,
    netToVendor: 43800,
    totalPaid: 20000,
    remainingBalance: 23800,
    installments: [
      {
        id: 1,
        amount: "20000",
        date: "2026-02-02",
        method: "Mobile money",
        proofName: "mpesa-receipt.pdf",
      },
    ],
    soldOn: "Feb 2, 2026",
    agreementFile: "",
  },
];

const initialSales: SalesRecord[] = [
  {
    id: "SALE-1044",
    parcelName: "Olive Ridge",
    parcelId: "SLD-233",
    buyer: "N. Wanjiru",
    salePrice: 33000,
    processingFee: 900,
    netToVendor: 32100,
    totalPaid: 32100,
    remainingBalance: 0,
    installments: [
      {
        id: 1,
        amount: "32100",
        date: "2026-01-18",
        method: "Bank transfer",
        proofName: "bank-slip.pdf",
      },
    ],
    soldOn: "Jan 18, 2026",
    agreementFile: "",
  },
];


export default function VendorDashboard() {
  const [newListingOpen, setNewListingOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "active" | "drafts" | "inquiries" | "sold" | "pending" | "sales"
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
  const [expandedPendingId, setExpandedPendingId] = useState<string | null>(
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
  const [charges, setCharges] = useState<
    { id: number; label: string; amount: string; kind: "charge" | "expense" }[]
  >([{ id: 1, label: "Processing fee", amount: "0", kind: "charge" }]);
  const [installments, setInstallments] = useState<SaleInstallment[]>([
    {
      id: 1,
      amount: "",
      date: "",
      method: "Mobile money",
      proofName: "",
    },
  ]);
  const [vendorLogo, setVendorLogo] = useState<string | null>(null);
  const [listingParcel, setListingParcel] = useState("");
  const [listingSize, setListingSize] = useState("");
  const [listingPrice, setListingPrice] = useState("");
  const [listingAmenities, setListingAmenities] = useState<string[]>([]);
  const [listingStep, setListingStep] = useState<1 | 2 | 3>(1);
  const [panoramaNodes, setPanoramaNodes] = useState<
    DraftNode[]
  >([{ id: 1, label: "Node 1", files: null }]);
  const [subParcels, setSubParcels] = useState<
    {
      id: number;
      name: string;
      mappingActive: boolean;
      previewOpen: boolean;
      rawPath: { lat: number; lng: number }[];
      cleanPath: { lat: number; lng: number }[];
    }[]
  >([
    {
      id: 1,
      name: "Parcel A",
      mappingActive: false,
      previewOpen: false,
      rawPath: [],
      cleanPath: [],
    },
  ]);
  const [startPoint, setStartPoint] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const activeCaptureIdRef = useRef<number | null>(null);
  const [vendorProfile, setVendorProfile] = useState<{
    name: string;
    type: "Individual" | "Company";
    location?: string;
  } | null>(null);
  const [vendorId, setVendorId] = useState<string | null>(null);

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
      setPlots(mapped.length ? mapped : initialPlots);
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

  const startGpsCapture = (parcelId: number) => {
    if (!navigator.geolocation) {
      setLocationStatus("GPS not supported on this device.");
      return;
    }
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    activeCaptureIdRef.current = parcelId;
    setLocationStatus("Acquiring GPS signal…");
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setLocationStatus(
          `GPS accuracy ±${Math.round(pos.coords.accuracy)}m`
        );
        const nextPoint = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setSubParcels((current) =>
          current.map((item) => {
            if (item.id !== parcelId) return item;
            const last = item.rawPath[item.rawPath.length - 1];
            if (last && distance(last, nextPoint) < 3) {
              return item;
            }
            return {
              ...item,
              rawPath: [...item.rawPath, nextPoint],
            };
          })
        );
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
        const cleaned = simplifyPath(item.rawPath, 5);
        return {
          ...item,
          mappingActive: false,
          previewOpen: true,
          cleanPath: cleaned,
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
      const updated = current.map((sale) => {
        if (sale.id !== saleId) return sale;
        const nextInstallments = updater(sale.installments);
        const totalPaid = nextInstallments.reduce((sum, item) => {
          const paid = Number(item.amount) || 0;
          return sum + paid;
        }, 0);
        const remainingBalance = Math.max(sale.netToVendor - totalPaid, 0);
        if (vendorId) {
          updateDoc(doc(db, "pendingSales", sale.id), {
            installments: nextInstallments,
            totalPaid,
            remainingBalance,
          });
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
        if (vendorId) {
          toMove.forEach(async (sale) => {
            await setDoc(doc(db, "sales", sale.id), {
              vendorId,
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
    setInstallments([
      { id: 1, amount: "", date: "", method: "Mobile money", proofName: "" },
    ]);
    setSaleModalOpen(true);
  };

  const confirmSale = () => {
    if (!saleDraft) return;
    const salePrice = Number(salePriceInput) || 0;
    const totalDeductions = charges.reduce((sum, charge) => {
      const fee = Number(charge.amount) || 0;
      return sum + fee;
    }, 0);
    const totalPaid = installments.reduce((sum, installment) => {
      const paid = Number(installment.amount) || 0;
      return sum + paid;
    }, 0);
    const netToVendor = Math.max(salePrice - totalDeductions, 0);
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
      installments,
      soldOn: "Sold today",
      agreementFile: "",
    };
    if (remainingBalance > 0) {
      setPendingSalesRecords((current) => [newRecord, ...current]);
      if (vendorId) {
        setDoc(doc(db, "pendingSales", newRecord.id), {
          vendorId,
          ...newRecord,
          createdAt: serverTimestamp(),
        });
      }
    } else {
      setSalesRecords((current) => [newRecord, ...current]);
      if (vendorId) {
        setDoc(doc(db, "sales", newRecord.id), {
          vendorId,
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
    if (!vendorId) return;
    setDraftSaving(true);
    try {
      if (!draftId) {
        const docRef = await addDoc(collection(db, "draftListings"), {
          vendorId,
          name: listingParcel,
          acres: listingSize,
          price: listingPrice,
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
        await refreshDrafts(vendorId);
      } else {
        await updateDoc(doc(db, "draftListings", draftId), {
          name: listingParcel,
          acres: listingSize,
          price: listingPrice,
          amenities: listingAmenities,
          step: nextStep,
          nodes: panoramaNodes.map((node) => ({
            label: node.label,
            coords: node.coords ?? null,
            imageUrl: node.imageUrl ?? "",
          })),
          updatedAt: serverTimestamp(),
        });
        await refreshDrafts(vendorId);
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
        price: listingPrice,
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
      setPlots((current) => [
        {
          id: docRef.id,
          name: listingParcel || "Untitled",
          status: "Listed",
          acres: listingSize,
          price: listingPrice || "Ksh 0",
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

  return (
    <div className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top,_#f9f1e6,_#f2ede4_55%,_#efe7d8)] text-[#14110f]">
      <header className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="text-left">
          <p className="text-xs uppercase tracking-[0.35em] text-[#c77d4b]">
            Vendor workspace
          </p>
          <h1 className="mt-2 font-serif text-2xl text-[#14110f] sm:text-3xl">
            Welcome back, {vendorProfile?.name ?? "Amina"}.
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
                  {vendorProfile?.name ?? "Amina Diallo"}
                </p>
                <p className="text-xs text-[#5a4a44]">
                  {vendorProfile?.type ?? "Vendor"} ·{" "}
                  {vendorProfile?.location ?? "Western District"}
                </p>
              </div>
            </div>
            <div className="mt-6 space-y-3 text-xs">
              {[
                { label: "Active plots", value: "6" },
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
                { id: "sold", label: "Sold parcels" },
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
                        | "sold"
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
                    : activeTab === "sold"
                    ? "Sold"
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
                    : activeTab === "sold"
                    ? "Sold parcels"
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
                    {expandedPendingId === sale.id && (
                      <div className="mt-3 rounded-2xl border border-[#eadfce] bg-white px-3 py-3 text-[11px] text-[#5a4a44]">
                        <p className="text-[10px] uppercase tracking-[0.25em] text-[#a67047]">
                          Installments
                        </p>
                        <div className="mt-2 space-y-2">
                          {sale.installments.map((installment) => (
                            <div
                              key={installment.id}
                              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_140px_auto]"
                            >
                              <input
                                type="number"
                                value={installment.amount}
                                onChange={(event) =>
                                  updatePendingInstallments(sale.id, (items) =>
                                    items.map((item) =>
                                      item.id === installment.id
                                        ? {
                                            ...item,
                                            amount: event.target.value,
                                          }
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
                                  updatePendingInstallments(sale.id, (items) =>
                                    items.map((item) =>
                                      item.id === installment.id
                                        ? {
                                            ...item,
                                            date: event.target.value,
                                          }
                                        : item
                                    )
                                  )
                                }
                                className="rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                              />
                              <select
                                value={installment.method}
                                onChange={(event) =>
                                  updatePendingInstallments(sale.id, (items) =>
                                    items.map((item) =>
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
                                  updatePendingInstallments(sale.id, (items) =>
                                    items.length === 1
                                      ? items
                                      : items.filter(
                                          (item) => item.id !== installment.id
                                        )
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
                                      updatePendingInstallments(sale.id, (items) =>
                                        items.map((item) =>
                                          item.id === installment.id
                                            ? {
                                                ...item,
                                                proofName: file
                                                  ? file.name
                                                  : "",
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
                        <button
                          type="button"
                          onClick={() =>
                            updatePendingInstallments(sale.id, (items) => [
                              ...items,
                              {
                                id: Date.now(),
                                amount: "",
                                date: "",
                                method: "Mobile money",
                                proofName: "",
                              },
                            ])
                          }
                          className="mt-3 rounded-full border border-[#eadfce] px-3 py-2 text-[11px] text-[#5a4a44]"
                        >
                          Add installment
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

            {activeTab === "sold" && (
              <div className="mt-5 space-y-3 text-sm">
                {soldListings.map((sold) => (
                  <div
                    key={sold.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#eadfce] bg-[#fbf8f3] px-4 py-3"
                  >
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-[#a67047]">
                        {sold.id}
                      </p>
                      <p className="mt-1 font-semibold text-[#14110f]">
                        {sold.name}
                      </p>
                      <p className="mt-1 text-xs text-[#5a4a44]">
                        {sold.acres} · {sold.price}
                      </p>
                      {sold.totalParcels && (
                        <p className="mt-1 text-[11px] text-[#6b3e1e]">
                          Parcels sold: {sold.soldParcels} / {sold.totalParcels}
                        </p>
                      )}
                    </div>
                    <span className="rounded-full border border-[#eadfce] bg-white px-3 py-1 text-xs text-[#7a5f54]">
                      {sold.soldOn}
                    </span>
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
              { id: "sold", label: "Sold" },
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
                      | "sold"
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
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-[#a67047]">
                  Installments
                </label>
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
                            current.length === 1
                              ? current
                              : current.filter(
                                  (item) => item.id !== installment.id
                                )
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
                  {installments
                    .reduce((sum, installment) => {
                      const paid = Number(installment.amount) || 0;
                      return sum + paid;
                    }, 0)
                    .toLocaleString()}
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
                      installments.reduce((sum, installment) => {
                        const paid = Number(installment.amount) || 0;
                        return sum + paid;
                      }, 0),
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
                    onChange={(event) => setListingParcel(event.target.value)}
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
                    onChange={(event) => setListingSize(event.target.value)}
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
                    onChange={(event) => setListingPrice(event.target.value)}
                    placeholder="e.g. $48k"
                    className="mt-2 w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                  />
                </div>
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
                    Panorama instructions
                  </p>
                  <p className="mt-2 text-xs">
                    Start at the nearest landmark. Record your start point,
                    then capture a 360 at every turn, junction, or 20-40 meters.
                  </p>
                  <p className="mt-2 text-xs">
                    Keep the path continuous: each node should visually connect
                    to the previous one.
                  </p>
                  <p className="mt-2 text-xs">
                    Use your camera app to capture 360 photos, then upload each
                    node below.
                  </p>
                </div>

                <div className="rounded-2xl border border-[#eadfce] bg-white px-4 py-4">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-[#a67047]">
                    Start point
                  </p>
                  <p className="mt-2 text-xs">
                    Tap â€œPick my current locationâ€ at the landmark to record
                    the tour start.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setLocationStatus(null);
                        if (!navigator.geolocation) {
                          setLocationStatus("Geolocation not supported.");
                          return;
                        }
                        navigator.geolocation.getCurrentPosition(
                          (position) => {
                            const { latitude, longitude } = position.coords;
                            setStartPoint(
                              `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
                            );
                            setLocationStatus("Start point saved.");
                          },
                          () => {
                            setLocationStatus(
                              "Unable to access location. Check permissions."
                            );
                          },
                          { enableHighAccuracy: true, timeout: 10000 }
                        );
                      }}
                      className="rounded-full bg-[#1f3d2d] px-4 py-2 text-xs font-semibold text-white"
                    >
                      Pick my current location
                    </button>
                    {startPoint && (
                      <span className="rounded-full border border-[#eadfce] px-3 py-1 text-[11px] text-[#5a4a44]">
                        {startPoint}
                      </span>
                    )}
                  </div>
                  {locationStatus && (
                    <p className="mt-2 text-[11px] text-[#6b3e1e]">
                      {locationStatus}
                    </p>
                  )}
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
                            setPanoramaNodes((current) =>
                              current.map((item) =>
                                item.id === node.id
                                  ? { ...item, files }
                                  : item
                              )
                            );
                            const file = files?.[0];
                            if (file && vendorId) {
                              const fileRef = ref(
                                storage,
                                `vendors/${vendorId}/nodes/${node.id}-${file.name}`
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
                    className={`rounded-full border border-[#eadfce] px-3 py-2 text-xs ${
                      startPoint
                        ? "text-[#5a4a44]"
                        : "cursor-not-allowed text-[#b8a79e]"
                    }`}
                    disabled={!startPoint}
                  >
                    Add another node
                  </button>
                  <span className="text-[10px] text-[#6b3e1e]">
                    Record the start point before adding nodes.
                  </span>
                </div>
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
                        },
                      ])
                    }
                    className="mt-3 rounded-full border border-[#eadfce] px-3 py-2 text-xs text-[#5a4a44]"
                  >
                    Add another parcel
                  </button>
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
                                        previewOpen: false,
                                        rawPath: [],
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
    </div>
  );
}
