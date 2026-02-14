"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import type { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";
import { auth, db, realtimeDb, storage } from "../../lib/firebase";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import {
  onValue,
  ref as dbRef,
  set as dbSet,
  off as dbOff,
  remove,
  push,
  query as dbQuery,
  limitToLast,
} from "firebase/database";
import {
  type GoogleMapsApi,
  type MapsEventListener,
  type MapsMap,
  type MapsMarker,
  type MapsPolygon,
  loadGoogleMapsApi,
} from "../../lib/googleMapsLoader";

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
  mutationFormUrl?: string;
  mutationFormName?: string;
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
  parcelNumbers?: number[];
  manualParcelOverlays?: {
    parcelNumber: number;
    confidence?: number;
    points: { x: number; y: number }[];
  }[];
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

type UploadedAsset = {
  id: number;
  name: string;
  url: string;
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
  status?: "new" | "responded" | "successful";
  assignedAgentId?: string;
  assignedAgentName?: string;
  respondedById?: string;
  respondedByName?: string;
  respondedAt?: string;
  assignedAt?: string;
  successfulByName?: string;
  successfulAt?: string;
  nextFollowUpAt?: string;
  progressLogs?: {
    id: string;
    kind:
      | "call"
      | "site_visit"
      | "offer"
      | "objection"
      | "follow_up"
      | "system";
    note: string;
    byName: string;
    at: string;
    nextFollowUpAt?: string;
    channel?: "Call" | "WhatsApp" | "SMS" | "Email";
  }[];
  reminders?: {
    id: string;
    channel: "Call" | "WhatsApp" | "SMS" | "Email";
    scheduledAt: string;
    status: "scheduled" | "sent";
    note?: string;
    sentAt?: string;
  }[];
};

type VisitRequest = {
  id: string;
  plotId: string;
  plotLabel: string;
  vendorName: string;
  vendorId?: string | null;
  portalId?: string | null;
  requestedByName: string;
  requestedByPhone: string;
  preferredVisitAt: string;
  note?: string;
  status: "requested" | "visited";
  createdAtLabel: string;
  visitedByName?: string;
  visitedAtLabel?: string;
};

type LeadAiSuggestion = {
  nextSteps: string[];
  messageSuggestions: string[];
  riskLevel: "low" | "medium" | "high";
  rationale: string;
};

const inquiriesSeed: Inquiry[] = [];

type MemberPermissions = {
  admin?: boolean;
  create_listings?: boolean;
  add_sales?: boolean;
  view_inquiries?: boolean;
  view_leads?: boolean;
  manage_members?: boolean;
};
type MemberRole = "admin" | "agent";

const normalizeMemberRole = (role?: string): MemberRole =>
  role === "admin" ? "admin" : "agent";

const permissionsForRole = (role: MemberRole): MemberPermissions =>
  role === "admin"
    ? {
        admin: true,
        create_listings: true,
        add_sales: true,
        view_inquiries: true,
        view_leads: true,
        manage_members: true,
      }
    : {
        admin: false,
        create_listings: false,
        add_sales: true,
        view_inquiries: true,
        view_leads: true,
        manage_members: false,
      };

const BUSINESS_START_HOUR = 8;
const BUSINESS_END_HOUR = 17;
const INQUIRY_REASSIGN_AFTER_MS = 2 * 60 * 60 * 1000;
const SLA_RESPONSE_REMINDER_MS = 60 * 60 * 1000;
const SLA_UPDATE_REMINDER_MS = 4 * 60 * 60 * 1000;
const SLA_UPDATE_REASSIGN_MS = 8 * 60 * 60 * 1000;

const pickBalancedAgent = (
  agents: { id: string; name: string; email: string }[],
  inquiryPool: Inquiry[]
) => {
  if (!agents.length) return null;
  const counts = new Map<string, number>(agents.map((agent) => [agent.id, 0]));
  inquiryPool.forEach((item) => {
    if ((item.status ?? "new") === "successful") return;
    if (!item.assignedAgentId) return;
    if (!counts.has(item.assignedAgentId)) return;
    counts.set(item.assignedAgentId, (counts.get(item.assignedAgentId) ?? 0) + 1);
  });
  const minimumLoad = Math.min(...Array.from(counts.values()));
  const eligible = agents.filter((agent) => (counts.get(agent.id) ?? 0) === minimumLoad);
  return eligible[Math.floor(Math.random() * eligible.length)];
};

const isWithinBusinessHours = (date: Date) => {
  const hour = date.getHours();
  return hour >= BUSINESS_START_HOUR && hour < BUSINESS_END_HOUR;
};

const getBusinessElapsedMs = (start: Date, end: Date) => {
  if (end <= start) return 0;
  let total = 0;
  let cursor = new Date(start);
  while (cursor < end) {
    const dayStart = new Date(cursor);
    dayStart.setHours(BUSINESS_START_HOUR, 0, 0, 0);
    const dayEnd = new Date(cursor);
    dayEnd.setHours(BUSINESS_END_HOUR, 0, 0, 0);
    const segmentStart = new Date(Math.max(cursor.getTime(), dayStart.getTime()));
    const segmentEnd = new Date(Math.min(end.getTime(), dayEnd.getTime()));
    if (segmentEnd > segmentStart) {
      total += segmentEnd.getTime() - segmentStart.getTime();
    }
    cursor = new Date(cursor);
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }
  return total;
};

type AnchorPayload = {
  sessionId: string;
  measuredLat: number;
  measuredLng: number;
  deltaNorth: number;
  deltaEast: number;
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
};

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
  proofFile?: File | null;
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
  nextPaymentDate?: string;
  attachments?: {
    label: string;
    name: string;
    url?: string;
  }[];
  fullyPaid?: boolean;
  createdByAgentId?: string;
  createdByAgentName?: string;
};

const initialPendingSales: SalesRecord[] = [];

const initialSales: SalesRecord[] = [];

type MutationParcel = {
  parcelNumber: number;
  confidence?: number;
  points: { x: number; y: number }[];
};

const serializeSaleRecordForFirestore = (sale: SalesRecord) => {
  const payload: {
    id: string;
    parcelName: string;
    parcelId: string;
    buyer: string;
    salePrice: number;
    processingFee: number;
    netToVendor: number;
    totalPaid: number;
    remainingBalance: number;
    installments: Omit<SaleInstallment, "proofFile">[];
    soldOn: string;
    fullyPaid?: boolean;
    nextPaymentDate?: string;
    attachments?: { label: string; name: string; url?: string }[];
    createdByAgentId?: string;
    createdByAgentName?: string;
  } = {
    id: sale.id,
    parcelName: sale.parcelName,
    parcelId: sale.parcelId,
    buyer: sale.buyer,
    salePrice: sale.salePrice,
    processingFee: sale.processingFee,
    netToVendor: sale.netToVendor,
    totalPaid: sale.totalPaid,
    remainingBalance: sale.remainingBalance,
    installments: sale.installments.map((installment) => {
      const cleaned = {
        ...installment,
      } as SaleInstallment;
      delete cleaned.proofFile;
      if (!cleaned.proofName) delete cleaned.proofName;
      if (!cleaned.proofUrl) delete cleaned.proofUrl;
      return cleaned as Omit<SaleInstallment, "proofFile">;
    }),
    soldOn: sale.soldOn,
  };
  if (typeof sale.fullyPaid === "boolean") {
    payload.fullyPaid = sale.fullyPaid;
  }
  if (sale.nextPaymentDate) {
    payload.nextPaymentDate = sale.nextPaymentDate;
  }
  if (sale.attachments?.length) {
    payload.attachments = sale.attachments.map((attachment) => ({
      label: attachment.label,
      name: attachment.name,
      ...(attachment.url ? { url: attachment.url } : {}),
    }));
  }
  if (sale.createdByAgentId) {
    payload.createdByAgentId = sale.createdByAgentId;
  }
  if (sale.createdByAgentName) {
    payload.createdByAgentName = sale.createdByAgentName;
  }
  return payload;
};


export default function VendorDashboard() {
  const searchParams = useSearchParams();
  const [newListingOpen, setNewListingOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<
    | "active"
    | "drafts"
    | "inquiries"
    | "leads"
    | "visits"
    | "pending"
    | "sales"
    | "members"
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
  const [visitRequests, setVisitRequests] = useState<VisitRequest[]>([]);
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
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [leadAiSuggestions, setLeadAiSuggestions] = useState<
    Record<string, LeadAiSuggestion>
  >({});
  const [leadAiLoading, setLeadAiLoading] = useState<Record<string, boolean>>({});
  const [manualLeadName, setManualLeadName] = useState("");
  const [manualLeadPhone, setManualLeadPhone] = useState("");
  const [manualLeadParcel, setManualLeadParcel] = useState("");
  const [manualLeadMessage, setManualLeadMessage] = useState("");
  const [manualLeadAgentId, setManualLeadAgentId] = useState("");
  const [manualLeadSaving, setManualLeadSaving] = useState(false);
  const [manualLeadError, setManualLeadError] = useState<string | null>(null);
  const [leadProgressNote, setLeadProgressNote] = useState("");
  const [leadProgressKind, setLeadProgressKind] = useState<
    "call" | "site_visit" | "offer" | "objection" | "follow_up"
  >("follow_up");
  const [leadNextFollowUpAt, setLeadNextFollowUpAt] = useState("");
  const [leadReminderChannel, setLeadReminderChannel] = useState<
    "Call" | "WhatsApp" | "SMS" | "Email"
  >("WhatsApp");
  const [leadReminderAt, setLeadReminderAt] = useState("");
  const [leadProgressSaving, setLeadProgressSaving] = useState(false);
  const [leadStatusSaving, setLeadStatusSaving] = useState(false);
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
  >([]);
  const [installments, setInstallments] = useState<SaleInstallment[]>([]);
  const [nextPaymentDate, setNextPaymentDate] = useState("");
  const [saleAttachments, setSaleAttachments] = useState<
    { id: number; label: string; file: File | null; name: string }[]
  >([]);
  const [documentsOpenId, setDocumentsOpenId] = useState<string | null>(null);
  const [vendorLogo, setVendorLogo] = useState<string | null>(null);
  const [listingParcel, setListingParcel] = useState("");
  const [listingSize, setListingSize] = useState("");
  const [listingPrice, setListingPrice] = useState("");
  const [listingParcelCount, setListingParcelCount] = useState("1");
  const [listingStepError, setListingStepError] = useState<string | null>(null);
  const [listingAmenities, setListingAmenities] = useState<string[]>([]);
  const [listingStep, setListingStep] = useState<1 | 2 | 3>(1);
  const [mutationFormName, setMutationFormName] = useState("");
  const [mutationFormUrl, setMutationFormUrl] = useState("");
  const [mutationParcels, setMutationParcels] = useState<MutationParcel[]>([]);
  const [mutationFormUploading, setMutationFormUploading] = useState(false);
  const [surroundingImages, setSurroundingImages] = useState<UploadedAsset[]>(
    []
  );
  const [surroundingUploading, setSurroundingUploading] = useState(false);
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
      signalStrength?: number;
      waitingForFix?: boolean;
      hasGoodFix?: boolean;
      anchorPoint?: { lat: number; lng: number } | null;
      anchorLocked?: boolean;
      anchorLocking?: boolean;
      samplingCorner?: boolean;
      cornerSampleCount?: number;
      cornerCountdown?: number;
      cornerConfidences?: number[];
      lastCornerConfidence?: number;
      overallConfidence?: number;
      cornerHri?: number;
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
      signalStrength: 0,
      waitingForFix: false,
      hasGoodFix: false,
      anchorPoint: null,
      anchorLocked: false,
      anchorLocking: false,
      samplingCorner: false,
      cornerSampleCount: 0,
      cornerCountdown: 0,
      cornerConfidences: [],
      lastCornerConfidence: 0,
      overallConfidence: 0,
      cornerHri: 0,
    },
  ]);
  const [locationStatus, setLocationStatus] = useState<string | null>(null);
  const [mapPreviewOpen, setMapPreviewOpen] = useState(false);
  const mapPreviewRef = useRef<HTMLDivElement | null>(null);
  const googleMapsApiRef = useRef<GoogleMapsApi | null>(null);
  const mapPreviewInstanceRef = useRef<MapsMap | null>(null);
  const mapPreviewPolygonRef = useRef<Map<number, MapsPolygon>>(new Map());
  const anchorMapRef = useRef<HTMLDivElement | null>(null);
  const anchorMapInstanceRef = useRef<MapsMap | null>(null);
  const anchorMarkerRef = useRef<MapsMarker | null>(null);
  const anchorMapClickListenerRef = useRef<MapsEventListener | null>(null);
  const anchorWatchRef = useRef<number | null>(null);
  const anchorDbRef = useRef<ReturnType<typeof dbRef> | null>(null);
  const headingRef = useRef<number | null>(null);
  const stepsRef = useRef(0);
  const lastStepTimeRef = useRef(0);
  const lastMotionTimeRef = useRef(0);
  const stepsUsedRef = useRef<Record<number, number>>({});
  const anchorSamplesRef = useRef<
    Record<number, { start: number; samples: { lat: number; lng: number }[] }>
  >({});
  const kalmanStateRef = useRef<
    Record<
      number,
      {
        lat: { x: number; p: number };
        lng: { x: number; p: number };
      }
    >
  >({});
  const motionPermissionRef = useRef(false);
  const lastGpsTimestampRef = useRef<Record<number, number>>({});
  const watchIdRef = useRef<number | null>(null);
  const activeCaptureIdRef = useRef<number | null>(null);
  const cornerSampleRef = useRef<
    Record<
      number,
      {
        start: number;
        samples: { lat: number; lng: number }[];
        watchId: number | null;
        lastAccuracy?: number;
        timeoutId?: number;
        received: number;
        rejectedMotion: number;
      }
    >
  >({});
  const [vendorProfile, setVendorProfile] = useState<{
    name: string;
    type: "Individual" | "Company";
    location?: string;
  } | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [portalId, setPortalId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [userLoaded, setUserLoaded] = useState(false);
  const [memberPermissions, setMemberPermissions] =
    useState<MemberPermissions>({});
  const [isPortalAdmin, setIsPortalAdmin] = useState(false);
  const [accessDenied, setAccessDenied] = useState<string | null>(null);
  const [portalMembers, setPortalMembers] = useState<
    {
      id: string;
      name: string;
      email: string;
      role: MemberRole;
      permissions: MemberPermissions;
    }[]
  >([]);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<MemberRole>("agent");
  const [memberSaving, setMemberSaving] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<MemberRole>("agent");
  const [memberUpdating, setMemberUpdating] = useState(false);
  const [anchorSessionId, setAnchorSessionId] = useState<string | null>(null);
  const [anchorActive, setAnchorActive] = useState(false);
  const [anchorData, setAnchorData] = useState<AnchorPayload | null>(null);
  const [anchorStatus, setAnchorStatus] = useState<string | null>(null);
  const [anchorTrueCoord, setAnchorTrueCoord] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [anchorMapOpen, setAnchorMapOpen] = useState(false);
  const [anchorInputSessionId, setAnchorInputSessionId] = useState("");
  const [anchorSearchQuery, setAnchorSearchQuery] = useState("");
  const [anchorSearchResults, setAnchorSearchResults] = useState<
    { id: string; place_name: string; center: [number, number] }[]
  >([]);
  const [anchorSearchLoading, setAnchorSearchLoading] = useState(false);
  const [anchorSearchError, setAnchorSearchError] = useState<string | null>(
    null
  );
  const [mapSearchQuery, setMapSearchQuery] = useState("");
  const [mapSearchResults, setMapSearchResults] = useState<
    { id: string; place_name: string; center: [number, number] }[]
  >([]);
  const [mapSearchLoading, setMapSearchLoading] = useState(false);
  const [mapSearchError, setMapSearchError] = useState<string | null>(null);
  const [searchVisible, setSearchVisible] = useState({
    active: false,
    drafts: false,
    inquiries: false,
    leads: false,
    visits: false,
    pending: false,
    sales: false,
    members: false,
  });
  const [searchText, setSearchText] = useState({
    active: "",
    drafts: "",
    inquiries: "",
    leads: "",
    visits: "",
    pending: "",
    sales: "",
    members: "",
  });
  const googleMapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";
  const reducedLabelStyles = useMemo(
    () => [
      {
        featureType: "poi",
        elementType: "labels",
        stylers: [{ visibility: "off" }],
      },
      {
        featureType: "transit",
        elementType: "labels",
        stylers: [{ visibility: "off" }],
      },
      {
        featureType: "road.local",
        elementType: "labels",
        stylers: [{ visibility: "simplified" }],
      },
      {
        elementType: "labels.text.fill",
        stylers: [{ color: "#6a737d" }],
      },
      {
        elementType: "labels.text.stroke",
        stylers: [{ color: "#d2d7dd" }],
      },
    ],
    []
  );
  const getActiveVendorId = useCallback(
    () => vendorId ?? auth.currentUser?.uid ?? null,
    [vendorId]
  );
  const getDashboardScopeId = useCallback(() => {
    const activeVendorId = getActiveVendorId();
    if (!activeVendorId) return null;
    return portalId
      ? `portal:${portalId}:vendor:${activeVendorId}`
      : `vendor:${activeVendorId}`;
  }, [getActiveVendorId, portalId]);

  const selectedPlot = plots.find((plot) => plot.id === selectedPlotId) ?? null;

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const idFromUrl = searchParams.get("portalId");
    const idFromStorage = window.localStorage.getItem("activePortalId");
    const id = idFromUrl || idFromStorage;
    if (id) {
      setPortalId(id);
      if (idFromUrl) {
        window.localStorage.setItem("activePortalId", idFromUrl);
      }
      return;
    }
    setPortalId(null);
  }, [searchParams]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setVendorProfile(null);
        setUserName(null);
        setVendorId(null);
        setUserLoaded(true);
        return;
      }
      setVendorId(user.uid);
      const userSnap = await getDoc(doc(db, "users", user.uid));
      if (userSnap.exists()) {
        const userData = userSnap.data() as { name?: string; fullName?: string };
        setUserName(
          userData.name ||
            userData.fullName ||
            user.displayName ||
            user.email?.split("@")[0] ||
            "User"
        );
      } else {
        setUserName(
          user.displayName || user.email?.split("@")[0] || "User"
        );
      }
      setUserLoaded(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!portalId || !vendorId) return;
    const portalRef = doc(db, "vendorPortals", portalId);
    const unsubscribe = onSnapshot(portalRef, async (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as {
        name?: string;
        type?: "company" | "individual";
        location?: string;
        members?: Record<
          string,
          { role?: string; permissions?: MemberPermissions }
        >;
        memberIds?: string[];
      };
      setVendorProfile({
        name: data.name || "Portal",
        type: data.type === "company" ? "Company" : "Individual",
        location: data.location || "Location not set",
      });
      const member = data.members?.[vendorId];
      const role = normalizeMemberRole(member?.role);
      const adminFlag = role === "admin";
      setIsPortalAdmin(adminFlag);
      setMemberPermissions(permissionsForRole(role));
      if (!member) {
        setAccessDenied("Access denied. Contact admin for addition.");
      }
      const memberIds = data.memberIds ?? Object.keys(data.members ?? {});
      if (memberIds.length) {
        const usersSnap = await getDocs(
          query(collection(db, "users"), where("__name__", "in", memberIds))
        );
        const userMap = new Map<string, { name?: string; email?: string }>();
        usersSnap.forEach((docSnap) => {
          const u = docSnap.data() as { name?: string; email?: string };
          userMap.set(docSnap.id, u);
        });
        const nextMembers = memberIds.map((id) => {
          const memberData = data.members?.[id];
          const user = userMap.get(id);
          return {
            id,
            name: user?.name || "Member",
            email: user?.email || "",
            role: normalizeMemberRole(memberData?.role),
            permissions: permissionsForRole(normalizeMemberRole(memberData?.role)),
          };
        });
        setPortalMembers(nextMembers);
      } else {
        setPortalMembers([]);
      }
    });
    return () => unsubscribe();
  }, [portalId, vendorId]);

  useEffect(() => {
    const loadLegacyVendor = async () => {
      if (!vendorId || portalId) return;
      const snap = await getDoc(doc(db, "vendors", vendorId));
      if (snap.exists()) {
        const data = snap.data() as {
          name?: string;
          type?: "Individual" | "Company";
          location?: string;
        };
        setVendorProfile({
          name: data.name || "Vendor",
          type: data.type || "Individual",
          location: data.location || "Western District",
        });
      }
    };
    loadLegacyVendor();
  }, [portalId, vendorId]);

  useEffect(() => {
    if (portalId) return;
    setIsPortalAdmin(true);
    setMemberPermissions({
      admin: true,
      create_listings: true,
      add_sales: true,
      view_inquiries: true,
      view_leads: true,
      manage_members: true,
    });
  }, [portalId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("activeAnchorSessionId");
    if (stored) {
      setAnchorSessionId(stored);
      setAnchorInputSessionId(stored);
    }
  }, []);

  useEffect(() => {
    if (!portalId || !anchorSessionId) {
      setAnchorData(null);
      return;
    }
    const refPath = dbRef(
      realtimeDb,
      `anchor_telemetry/${portalId}/${anchorSessionId}`
    );
    anchorDbRef.current = refPath;
    const lastQuery = dbQuery(refPath, limitToLast(1));
    const handler = onValue(lastQuery, (snap) => {
      const data = snap.val() as Record<string, AnchorPayload> | null;
      if (data) {
        const last = Object.values(data)[0];
        setAnchorData(last ?? null);
      } else {
        setAnchorData(null);
      }
    });
    return () => {
      dbOff(refPath);
      if (typeof handler === "function") {
        handler();
      }
    };
  }, [anchorSessionId, portalId]);

  const portalDisplayName = hydrated
    ? vendorProfile?.name ?? "Portal"
    : "Portal";
  const portalLocation = hydrated
    ? vendorProfile?.location ?? "Western District"
    : "Western District";
  const userDisplayName = hydrated ? userName ?? "User" : "User";
  const greetingText = `Welcome back to ${portalDisplayName}.`;

  const canCreateListings = isPortalAdmin || memberPermissions.create_listings;
  const canAddSales = isPortalAdmin || memberPermissions.add_sales;
  const canViewInquiries = isPortalAdmin || memberPermissions.view_inquiries;
  const canViewLeads = isPortalAdmin || memberPermissions.view_leads;
  const canManageMembers = isPortalAdmin || memberPermissions.manage_members;
  const assignableAgents = useMemo(
    () =>
      portalMembers
        .filter((member) => member.role === "agent")
        .map((member) => ({
          id: member.id,
          name: member.name,
          email: member.email,
        })),
    [portalMembers]
  );

  const denyAccess = (message: string) => {
    setAccessDenied(message);
  };

  const canAccessTab = (tabId: string) => {
    if (tabId === "inquiries") return canViewInquiries;
    if (tabId === "leads") return canViewLeads;
    if (tabId === "visits") return canViewLeads;
    if (tabId === "active") return true;
    if (tabId === "drafts") return canCreateListings;
    if (tabId === "pending" || tabId === "sales") return canAddSales;
    if (tabId === "members") return canManageMembers;
    return true;
  };

  const handleTabChange = (
    tabId:
      | "active"
      | "drafts"
      | "inquiries"
      | "leads"
      | "visits"
      | "pending"
      | "sales"
      | "members"
  ) => {
    if (!canAccessTab(tabId)) {
      denyAccess("Access denied. Contact admin for addition.");
      return;
    }
    setActiveTab(tabId);
  };

  const logLeadProgress = async () => {
    if (!selectedLeadId) return;
    const note = leadProgressNote.trim();
    if (!note) return;
    setLeadProgressSaving(true);
    const nowIso = new Date().toISOString();
    const entry = {
      id: `${Date.now()}`,
      kind: leadProgressKind,
      note,
      byId: vendorId ?? "",
      byName: userDisplayName ?? "Member",
      at: nowIso,
      ...(leadNextFollowUpAt ? { nextFollowUpAt: leadNextFollowUpAt } : {}),
      channel: leadReminderChannel,
    };
    const reminder =
      leadReminderAt.trim().length > 0
        ? {
            id: `${Date.now()}-reminder`,
            channel: leadReminderChannel,
            scheduledAt: leadReminderAt,
            status: "scheduled" as const,
            note,
          }
        : null;
    try {
      await updateDoc(doc(db, "inquiries", selectedLeadId), {
        progressLogs: arrayUnion(entry),
        ...(reminder ? { reminders: arrayUnion(reminder) } : {}),
        ...(leadNextFollowUpAt ? { nextFollowUpAt: leadNextFollowUpAt } : {}),
      });
      setInquiries((current) =>
        current.map((item) =>
          item.id === selectedLeadId
            ? {
                ...item,
                progressLogs: [
                  ...(item.progressLogs ?? []),
                  {
                    id: entry.id,
                    kind: entry.kind,
                    note: entry.note,
                    byName: entry.byName,
                    at: new Date(entry.at).toLocaleString(),
                    ...(entry.nextFollowUpAt
                      ? { nextFollowUpAt: entry.nextFollowUpAt }
                      : {}),
                    channel: entry.channel,
                  },
                ],
                ...(leadNextFollowUpAt ? { nextFollowUpAt: leadNextFollowUpAt } : {}),
                ...(reminder
                  ? {
                      reminders: [
                        ...(item.reminders ?? []),
                        {
                          id: reminder.id,
                          channel: reminder.channel,
                          scheduledAt: reminder.scheduledAt,
                          status: "scheduled",
                          note: reminder.note,
                        },
                      ],
                    }
                  : {}),
              }
            : item
        )
      );
      setLeadProgressNote("");
      setLeadNextFollowUpAt("");
      setLeadReminderAt("");
    } finally {
      setLeadProgressSaving(false);
    }
  };

  const markLeadSuccessful = async () => {
    if (!selectedLeadId) return;
    setLeadStatusSaving(true);
    try {
      await updateDoc(doc(db, "inquiries", selectedLeadId), {
        status: "successful",
        successfulById: vendorId ?? "",
        successfulByName: userDisplayName ?? "Member",
        successfulAt: serverTimestamp(),
      });
      setInquiries((current) =>
        current.map((item) =>
          item.id === selectedLeadId
            ? {
                ...item,
                status: "successful",
                successfulByName: userDisplayName ?? "Member",
                successfulAt: new Date().toLocaleString(),
              }
            : item
        )
      );
    } finally {
      setLeadStatusSaving(false);
    }
  };

  const markVisitAsVisited = async (visitId: string) => {
    try {
      await updateDoc(doc(db, "visitBookings", visitId), {
        status: "visited",
        visitedById: vendorId ?? "",
        visitedByName: userDisplayName ?? "Member",
        visitedAt: serverTimestamp(),
      });
      setVisitRequests((current) =>
        current.map((item) =>
          item.id === visitId
            ? {
                ...item,
                status: "visited",
                visitedByName: userDisplayName ?? "Member",
                visitedAtLabel: new Date().toLocaleString(),
              }
            : item
        )
      );
    } catch {
      // keep UI responsive if visit status update fails
    }
  };

  const generateLeadAiSuggestions = async (lead: Inquiry) => {
    if (leadAiLoading[lead.id]) return;
    setLeadAiLoading((current) => ({ ...current, [lead.id]: true }));
    try {
      const response = await fetch("/api/gemini/lead-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead: {
            id: lead.id,
            buyer: lead.buyer,
            parcel: lead.parcel,
            phone: lead.phone,
            status: lead.status ?? "new",
            assignedAgentName: lead.assignedAgentName,
            respondedByName: lead.respondedByName,
            progressLogs: lead.progressLogs ?? [],
            message: lead.message,
          },
        }),
      });
      if (!response.ok) return;
      const payload = (await response.json()) as LeadAiSuggestion;
      if (!payload?.nextSteps?.length && !payload?.messageSuggestions?.length) return;
      setLeadAiSuggestions((current) => ({ ...current, [lead.id]: payload }));
    } finally {
      setLeadAiLoading((current) => ({ ...current, [lead.id]: false }));
    }
  };

  const createManualLead = async () => {
    const buyerName = manualLeadName.trim();
    const buyerPhone = manualLeadPhone.trim();
    if (!buyerName || !buyerPhone) {
      setManualLeadError("Lead name and phone are required.");
      return;
    }
    const scopeId = getDashboardScopeId();
    if (!scopeId) {
      setManualLeadError("Unable to identify workspace scope.");
      return;
    }
    setManualLeadSaving(true);
    setManualLeadError(null);
    try {
      let targetAgentId = manualLeadAgentId;
      let targetAgentName = "";
      if (!targetAgentId) {
        const selected = pickBalancedAgent(assignableAgents, inquiries);
        if (selected) {
          targetAgentId = selected.id;
          targetAgentName = selected.name || selected.email || "Agent";
        }
      } else {
        const selected = assignableAgents.find((agent) => agent.id === targetAgentId);
        targetAgentName = selected?.name || selected?.email || "Agent";
      }
      const payload = {
        buyerName,
        buyerPhone,
        plotLabel: manualLeadParcel.trim() || "Direct lead",
        message: manualLeadMessage.trim() || "Manual lead captured by team.",
        preferredContact: "Call" as const,
        status: "responded" as const,
        vendorName: vendorProfile?.name ?? "Vendor",
        vendorType: vendorProfile?.type ?? "Individual",
        vendorId: getActiveVendorId(),
        portalId: portalId ?? null,
        dashboardScopeId: scopeId,
        assignedAgentId: targetAgentId,
        assignedAgentName: targetAgentName,
        ...(targetAgentId ? { assignedAt: serverTimestamp() } : {}),
        respondedById: vendorId ?? "",
        respondedByName: userDisplayName ?? "Member",
        respondedAt: serverTimestamp(),
        progressLogs: [
          {
            id: `${Date.now()}-manual-capture`,
            kind: "system",
            note: "Manual lead created from vendor portal.",
            byId: vendorId ?? "",
            byName: userDisplayName ?? "Member",
            at: new Date().toISOString(),
          },
        ],
        createdAt: serverTimestamp(),
      };
      await addDoc(collection(db, "inquiries"), payload);
      setManualLeadName("");
      setManualLeadPhone("");
      setManualLeadParcel("");
      setManualLeadMessage("");
      setManualLeadAgentId("");
      setActiveTab("leads");
    } catch {
      setManualLeadError("Unable to create manual lead. Try again.");
    } finally {
      setManualLeadSaving(false);
    }
  };

  useEffect(() => {
    if (!canAccessTab(activeTab)) {
      setActiveTab("active");
      denyAccess("Access denied. Contact admin for addition.");
    }
  }, [activeTab, canCreateListings, canViewInquiries, canViewLeads, canManageMembers, canAddSales]);

  useEffect(() => {
    setLeadProgressNote("");
    setLeadProgressKind("follow_up");
    setLeadNextFollowUpAt("");
    setLeadReminderAt("");
    setLeadReminderChannel("WhatsApp");
  }, [selectedLeadId]);

  const loadingView = (
    <div className="min-h-screen bg-[radial-gradient(circle_at_12%_10%,_rgba(209,167,65,0.22),_transparent_28%),radial-gradient(circle_at_88%_12%,_rgba(74,160,255,0.2),_transparent_34%),linear-gradient(120deg,_#050b1a_0%,_#07122a_45%,_#091631_100%)] text-[#e8eefc]">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-4 py-10 sm:px-6">
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-3xl bg-[#0d1f3f] shadow-[0_18px_50px_-30px_rgba(0,0,0,0.9)]">
          <img src="/logo.png" alt="PlotTrust logo" className="h-10 w-10" />
        </div>
        <div className="mt-6 text-center">
          <p className="text-xs uppercase tracking-[0.35em] text-[#d1a741]">
            Vendor workspace
          </p>
          <h1 className="mt-2 font-serif text-2xl text-[#f2f6ff] sm:text-3xl">
            Loading your portal
          </h1>
          <p className="mt-2 text-sm text-[#c6d6f7]">
            Preparing your listings, members, and sales.
          </p>
        </div>
        <div className="mt-6 flex items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#2c4f8a] border-t-[#d1a741]" />
          <div className="text-xs text-[#9eb6e1]">
            Syncing workspace data
          </div>
        </div>
      </div>
    </div>
  );

  const addMemberByEmail = async () => {
    if (!portalId || !vendorId) return;
    if (!canManageMembers) {
      denyAccess("Access denied. Contact admin for addition.");
      return;
    }
    const email = memberEmail.trim().toLowerCase();
    if (!email) {
      setMemberError("Enter a member email.");
      return;
    }
    setMemberSaving(true);
    setMemberError(null);
    try {
      let userDocId: string | null = null;
      let userData: { name?: string; email?: string } | null = null;
      let snap = await getDocs(
        query(collection(db, "users"), where("emailLower", "==", email))
      );
      if (snap.empty) {
        snap = await getDocs(
          query(collection(db, "users"), where("email", "==", email))
        );
      }
      if (!snap.empty) {
        const docSnap = snap.docs[0];
        userDocId = docSnap.id;
        userData = docSnap.data() as { name?: string; email?: string };
      }
      if (!userDocId) {
        setMemberError("No user found with that email.");
        return;
      }
      const normalizedPerms = permissionsForRole(memberRole);
      await updateDoc(doc(db, "vendorPortals", portalId), {
        memberIds: arrayUnion(userDocId),
        [`members.${userDocId}`]: {
          role: memberRole,
          name: userData?.name || email,
          email: userData?.email || email,
          permissions: normalizedPerms,
        },
      });
      setPortalMembers((current) => {
        const exists = current.some((item) => item.id === userDocId);
        if (exists) return current;
        return [
          ...current,
          {
            id: userDocId!,
            name: userData?.name || email,
            email: userData?.email || email,
            role: memberRole,
            permissions: normalizedPerms,
          },
        ];
      });
      setMemberEmail("");
    } catch {
      setMemberError("Unable to add member. Try again.");
    } finally {
      setMemberSaving(false);
    }
  };

  const removeMember = async (memberId: string) => {
    if (!portalId) return;
    if (!canManageMembers) {
      denyAccess("Access denied. Contact admin for addition.");
      return;
    }
    if (!window.confirm("Remove this member from the portal?")) return;
    try {
      await updateDoc(doc(db, "vendorPortals", portalId), {
        memberIds: arrayRemove(memberId),
        [`members.${memberId}`]: deleteField(),
      });
      setPortalMembers((current) =>
        current.filter((member) => member.id !== memberId)
      );
    } catch {
      setAccessDenied("Unable to remove member. Try again.");
    }
  };

  const startEditMember = (member: {
    id: string;
    role: MemberRole;
    permissions: MemberPermissions;
  }) => {
    setEditingMemberId(member.id);
    setEditingRole(member.role);
  };

  const saveMemberPermissions = async () => {
    if (!portalId || !editingMemberId) return;
    if (!canManageMembers) {
      denyAccess("Access denied. Contact admin for addition.");
      return;
    }
    setMemberUpdating(true);
    try {
      const normalizedPerms = permissionsForRole(editingRole);
      await updateDoc(doc(db, "vendorPortals", portalId), {
        [`members.${editingMemberId}.role`]: editingRole,
        [`members.${editingMemberId}.permissions`]: normalizedPerms,
      });
      setPortalMembers((current) =>
        current.map((member) =>
          member.id === editingMemberId
            ? {
                ...member,
                role: editingRole,
                permissions: normalizedPerms,
              }
            : member
        )
      );
      setEditingMemberId(null);
    } catch {
      setAccessDenied("Unable to update member. Try again.");
    } finally {
      setMemberUpdating(false);
    }
  };

  // Render full tree always to keep hooks order stable; use hydration-safe text.

  async function loadDraftsForScope(scopeId: string) {
    let snapshot;
    try {
      snapshot = await getDocs(
        query(
          collection(db, "draftListings"),
          where("dashboardScopeId", "==", scopeId),
          orderBy("updatedAt", "desc")
        )
      );
    } catch {
      snapshot = await getDocs(
        query(
          collection(db, "draftListings"),
          where("dashboardScopeId", "==", scopeId)
        )
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
  }

  useEffect(() => {
    const loadDrafts = async () => {
      const scopeId = getDashboardScopeId();
      if (!scopeId) {
        setDraftListings([]);
        return;
      }
      await loadDraftsForScope(scopeId);
    };
    loadDrafts();
  }, [vendorId, portalId, getDashboardScopeId]);

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
    if (!window.DeviceMotionEvent) return;
    const handler = (event: DeviceMotionEvent) => {
      const acc = event.accelerationIncludingGravity;
      if (!acc) return;
      const x = acc.x ?? 0;
      const y = acc.y ?? 0;
      const z = acc.z ?? 0;
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      const now = Date.now();
      if (magnitude > 12.2) {
        lastMotionTimeRef.current = now;
      }
      if (magnitude > 12.5 && now - lastStepTimeRef.current > 350) {
        stepsRef.current += 1;
        lastStepTimeRef.current = now;
      }
    };
    window.addEventListener("devicemotion", handler, true);
    return () => window.removeEventListener("devicemotion", handler, true);
  }, []);

  useEffect(() => {
    const loadListings = async () => {
      const scopeId = getDashboardScopeId();
      if (!scopeId) return;
      const snapshot = portalId
        ? await getDocs(
            query(collection(db, "listings"), where("portalId", "==", portalId))
          )
        : await getDocs(
            query(
              collection(db, "listings"),
              where("dashboardScopeId", "==", scopeId)
            )
          );
      const mapped: VendorPlot[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as {
          name?: string;
          acres?: string;
          price?: string;
          parcels?: { name?: string }[];
          soldParcelIds?: number[];
          availableParcels?: number;
          mutationForm?: { name?: string; url?: string } | null;
          mutationParcels?: MutationParcel[];
          soldParcelOverlays?: MutationParcel[];
          manualParcelOverlays?: {
            parcelNumber?: number;
            confidence?: number;
            points?: { x?: number; y?: number }[];
          }[];
        };
        const totalParcels = data.parcels?.length ?? 1;
        const soldParcelIds = data.soldParcelIds ?? [];
        const mutationParcels = (data.mutationParcels ?? [])
          .map((parcel) => ({
            parcelNumber: Math.trunc(Number(parcel.parcelNumber)),
            confidence:
              typeof parcel.confidence === "number"
                ? parcel.confidence
                : undefined,
            points: (parcel.points ?? [])
              .map((point) => ({
                x: Number(point.x),
                y: Number(point.y),
              }))
              .filter(
                (point) => Number.isFinite(point.x) && Number.isFinite(point.y)
              ),
          }))
          .filter((parcel) => parcel.parcelNumber > 0 && parcel.points.length >= 3)
          .sort((a, b) => a.parcelNumber - b.parcelNumber);
        const soldParcelOverlays = (data.soldParcelOverlays ?? [])
          .map((parcel) => ({
            parcelNumber: Math.trunc(Number(parcel.parcelNumber)),
            confidence:
              typeof parcel.confidence === "number"
                ? parcel.confidence
                : undefined,
            points: (parcel.points ?? [])
              .map((point) => ({
                x: Number(point.x),
                y: Number(point.y),
              }))
              .filter(
                (point) => Number.isFinite(point.x) && Number.isFinite(point.y)
              ),
          }))
          .filter((parcel) => parcel.parcelNumber > 0 && parcel.points.length >= 3)
          .sort((a, b) => a.parcelNumber - b.parcelNumber);
        const parcelNumbers =
          mutationParcels.length > 0
            ? mutationParcels.map((parcel) => parcel.parcelNumber)
            : Array.from({ length: totalParcels }, (_, idx) => idx + 1);
        const availableParcels =
          typeof data.availableParcels === "number"
            ? data.availableParcels
            : Math.max(totalParcels - soldParcelIds.length, 0);
        if (availableParcels <= 0) {
          return;
        }
        mapped.push({
          id: docSnap.id,
          name: data.name || "Untitled",
          status: "Listed",
          acres: data.acres || "",
          price: data.price || "Ksh 0",
          confidence: "—",
          totalParcels,
          soldParcelIds,
          availableParcels,
          mutationFormUrl: data.mutationForm?.url,
          mutationFormName: data.mutationForm?.name,
          mutationParcels,
          soldParcelOverlays,
          parcelNumbers,
          manualParcelOverlays: (data.manualParcelOverlays ?? [])
            .map((overlay) => ({
              parcelNumber: Math.trunc(Number(overlay.parcelNumber)),
              confidence:
                typeof overlay.confidence === "number"
                  ? overlay.confidence
                  : undefined,
              points: (overlay.points ?? [])
                .map((point) => ({
                  x: Number(point.x),
                  y: Number(point.y),
                }))
                .filter(
                  (point) => Number.isFinite(point.x) && Number.isFinite(point.y)
                ),
            }))
            .filter(
              (overlay) =>
                overlay.parcelNumber > 0 && overlay.points.length >= 3
            ),
        });
      });
      setPlots(mapped);
    };
    loadListings();
  }, [vendorId, portalId, getDashboardScopeId]);

  useEffect(() => {
    const loadSales = async () => {
      const scopeId = getDashboardScopeId();
      if (!scopeId && !portalId) return;
      const pendingFilters = portalId
        ? [where("portalId", "==", portalId)]
        : [where("dashboardScopeId", "==", scopeId)];
      const salesFilters = portalId
        ? [where("portalId", "==", portalId)]
        : [where("dashboardScopeId", "==", scopeId)];
      if (!isPortalAdmin && vendorId) {
        pendingFilters.push(where("createdByAgentId", "==", vendorId));
        salesFilters.push(where("createdByAgentId", "==", vendorId));
      }
      const pendingSnap = await getDocs(
        query(collection(db, "pendingSales"), ...pendingFilters)
      );
      const salesSnap = await getDocs(
        query(collection(db, "sales"), ...salesFilters)
      );
      const mapSale = (
        docSnap: QueryDocumentSnapshot<DocumentData>
      ): SalesRecord => {
        const data = docSnap.data() as SalesRecord;
        return {
          ...data,
          id: docSnap.id,
        };
      };
      setPendingSalesRecords(pendingSnap.docs.map(mapSale));
      setSalesRecords(salesSnap.docs.map(mapSale));
    };
    loadSales();
  }, [vendorId, portalId, getDashboardScopeId, isPortalAdmin]);

  useEffect(() => {
    const loadInquiries = async () => {
      if (!canViewInquiries && !canViewLeads) {
        setInquiries([]);
        return;
      }
      const scopeId = getDashboardScopeId();
      const vendorName = vendorProfile?.name;
      if (!scopeId && !vendorName) return;
      let snapshot;
      try {
        snapshot = portalId
          ? await getDocs(
              query(
                collection(db, "inquiries"),
                where("portalId", "==", portalId),
                orderBy("createdAt", "desc")
              )
            )
          : await getDocs(
              query(
                collection(db, "inquiries"),
                scopeId
                  ? where("dashboardScopeId", "==", scopeId)
                  : where("vendorName", "==", vendorName),
                orderBy("createdAt", "desc")
              )
            );
      } catch {
        snapshot = portalId
          ? await getDocs(
              query(collection(db, "inquiries"), where("portalId", "==", portalId))
            )
          : await getDocs(
              query(
                collection(db, "inquiries"),
                scopeId
                  ? where("dashboardScopeId", "==", scopeId)
                  : where("vendorName", "==", vendorName)
              )
            );
      }
      if (portalId && snapshot.empty && vendorName) {
        snapshot = await getDocs(
          query(collection(db, "inquiries"), where("vendorName", "==", vendorName))
        );
      }
      const items: Inquiry[] = [];
      const pendingAssignments: {
        id: string;
        assignedAgentId: string;
        assignedAgentName: string;
        assignedAtNow: boolean;
      }[] = [];
      const pendingAutomationUpdates: {
        id: string;
        payload: Record<string, unknown>;
      }[] = [];
      const memberNameById = new Map(
        portalMembers.map((member) => [member.id, member.name || member.email || "Agent"])
      );
      const docs = snapshot.docs;
      const assignmentCounts = new Map<string, number>(
        assignableAgents.map((agent) => [agent.id, 0])
      );
      docs.forEach((docSnap) => {
        const data = docSnap.data() as {
          status?: "new" | "responded" | "successful";
          assignedAgentId?: string;
        };
        if (data.status === "successful") return;
        if (!data.assignedAgentId) return;
        if (!assignmentCounts.has(data.assignedAgentId)) return;
        assignmentCounts.set(
          data.assignedAgentId,
          (assignmentCounts.get(data.assignedAgentId) ?? 0) + 1
        );
      });
      const now = new Date();
      const canAutoReassign = isWithinBusinessHours(now);
      docs.forEach((docSnap) => {
        const data = docSnap.data() as {
          buyerName?: string;
          buyerPhone?: string;
          preferredContact?: "Call" | "Text" | "WhatsApp";
          message?: string;
          plotLabel?: string;
          createdAt?: { toDate: () => Date };
          assignedAt?: { toDate: () => Date };
          status?: "new" | "responded" | "successful";
          assignedAgentId?: string;
          assignedAgentName?: string;
          respondedById?: string;
          respondedByName?: string;
          respondedAt?: { toDate: () => Date };
          successfulByName?: string;
          successfulAt?: { toDate: () => Date };
          nextFollowUpAt?: string;
          lastResponseReminderAt?: { toDate: () => Date };
          lastUpdateReminderAt?: { toDate: () => Date };
          progressLogs?: {
            id?: string;
            kind?:
              | "call"
              | "site_visit"
              | "offer"
              | "objection"
              | "follow_up"
              | "system";
            note?: string;
            byName?: string;
            at?: string | { toDate: () => Date };
            nextFollowUpAt?: string;
            channel?: "Call" | "WhatsApp" | "SMS" | "Email";
          }[];
          reminders?: {
            id?: string;
            channel?: "Call" | "WhatsApp" | "SMS" | "Email";
            scheduledAt?: string;
            status?: "scheduled" | "sent";
            note?: string;
            sentAt?: string;
          }[];
        };
        const createdAt = data.createdAt?.toDate();
        const assignedAt = data.assignedAt?.toDate() ?? createdAt ?? now;
        const respondedAtDate = data.respondedAt?.toDate?.();
        const successfulAtDate = data.successfulAt?.toDate?.();
        let assignedAgentId = data.assignedAgentId ?? "";
        let assignedAgentName =
          data.assignedAgentName ??
          (assignedAgentId ? memberNameById.get(assignedAgentId) ?? "" : "");
        if (!assignedAgentId && portalId && assignableAgents.length) {
          const status = data.status ?? "new";
          if (status === "new") {
            const minimumLoad = Math.min(...Array.from(assignmentCounts.values()));
            const eligibleAgents = assignableAgents.filter(
              (agent) => (assignmentCounts.get(agent.id) ?? 0) === minimumLoad
            );
            const selectedAgent =
              eligibleAgents[
                Math.floor(Math.random() * eligibleAgents.length)
              ];
            assignedAgentId = selectedAgent.id;
            assignedAgentName =
              selectedAgent.name || selectedAgent.email || "Agent";
            assignmentCounts.set(
              selectedAgent.id,
              (assignmentCounts.get(selectedAgent.id) ?? 0) + 1
            );
            pendingAssignments.push({
              id: docSnap.id,
              assignedAgentId,
              assignedAgentName,
              assignedAtNow: true,
            });
          }
        } else if (
          assignedAgentId &&
          portalId &&
          assignableAgents.length > 1 &&
          canAutoReassign &&
          (data.status ?? "new") === "new"
        ) {
          const elapsed = getBusinessElapsedMs(assignedAt, now);
          if (elapsed >= INQUIRY_REASSIGN_AFTER_MS) {
            const currentCount = assignmentCounts.get(assignedAgentId) ?? 0;
            assignmentCounts.set(assignedAgentId, Math.max(currentCount - 1, 0));
            const candidates = assignableAgents.filter(
              (agent) => agent.id !== assignedAgentId
            );
            if (candidates.length) {
              const minimumLoad = Math.min(
                ...candidates.map((agent) => assignmentCounts.get(agent.id) ?? 0)
              );
              const eligibleAgents = candidates.filter(
                (agent) => (assignmentCounts.get(agent.id) ?? 0) === minimumLoad
              );
              const selectedAgent =
                eligibleAgents[
                  Math.floor(Math.random() * eligibleAgents.length)
                ];
              assignedAgentId = selectedAgent.id;
              assignedAgentName =
                selectedAgent.name || selectedAgent.email || "Agent";
              assignmentCounts.set(
                selectedAgent.id,
                (assignmentCounts.get(selectedAgent.id) ?? 0) + 1
              );
              pendingAssignments.push({
                id: docSnap.id,
                assignedAgentId,
                assignedAgentName,
                assignedAtNow: true,
              });
            } else {
              assignmentCounts.set(assignedAgentId, currentCount);
            }
          }
        }
        const progressLogs = (data.progressLogs ?? [])
          .map((log, index) => {
            let atDate: Date | null = null;
            let atLabel = "";
            if (typeof log.at === "string") {
              const parsed = new Date(log.at);
              if (!Number.isNaN(parsed.getTime())) {
                atDate = parsed;
                atLabel = parsed.toLocaleString();
              } else {
                atLabel = log.at;
              }
            } else if (log.at?.toDate) {
              atDate = log.at.toDate();
              atLabel = atDate.toLocaleString();
            }
            return {
              id: log.id || `${docSnap.id}-log-${index}`,
              kind: log.kind || "follow_up",
              note: log.note || "",
              byName: log.byName || "Member",
              at: atLabel || "Just now",
              atDate,
              nextFollowUpAt: log.nextFollowUpAt,
              channel: log.channel,
            };
          })
          .filter((log) => log.note.trim().length > 0);
        const latestProgressAt = progressLogs
          .filter((log) => log.atDate instanceof Date)
          .sort((a, b) => b.atDate!.getTime() - a.atDate!.getTime())[0]?.atDate;
        const lastActivityAt = latestProgressAt ?? respondedAtDate ?? assignedAt;
        const reminders = (data.reminders ?? [])
          .map((reminder, index) => ({
            id: reminder.id || `${docSnap.id}-reminder-${index}`,
            channel: reminder.channel || "WhatsApp",
            scheduledAt: reminder.scheduledAt || "",
            status: reminder.status || "scheduled",
            note: reminder.note,
            sentAt: reminder.sentAt,
          }))
          .filter((reminder) => reminder.scheduledAt);
        const dueReminderIndexes = reminders
          .map((reminder, index) => ({ reminder, index }))
          .filter(({ reminder }) => {
            if (reminder.status !== "scheduled") return false;
            const scheduled = new Date(reminder.scheduledAt);
            if (Number.isNaN(scheduled.getTime())) return false;
            if (scheduled > now) return false;
            if (!isWithinBusinessHours(now)) return false;
            return isPortalAdmin || assignedAgentId === vendorId;
          });
        const automationPayload: Record<string, unknown> = {};
        const automationLogs: {
          id: string;
          kind: "system";
          note: string;
          byId: string;
          byName: string;
          at: string;
          channel?: "Call" | "WhatsApp" | "SMS" | "Email";
        }[] = [];
        if (dueReminderIndexes.length) {
          const updatedReminders = reminders.map((reminder) => ({ ...reminder }));
          dueReminderIndexes.forEach(({ reminder, index }) => {
            updatedReminders[index] = {
              ...updatedReminders[index],
              status: "sent",
              sentAt: now.toISOString(),
            };
            automationLogs.push({
              id: `${Date.now()}-${index}-system-reminder`,
              kind: "system",
              note: `Automated ${reminder.channel} reminder sent${
                reminder.note ? `: ${reminder.note}` : ""
              }`,
              byId: "system",
              byName: "System",
              at: now.toISOString(),
              channel: reminder.channel,
            });
          });
          automationPayload.reminders = updatedReminders;
        }
        if ((data.status ?? "new") === "new" && assignedAgentId && canAutoReassign) {
          const elapsedSinceAssigned = getBusinessElapsedMs(assignedAt, now);
          const lastResponseReminderAt = data.lastResponseReminderAt?.toDate?.();
          const elapsedSinceResponseReminder = lastResponseReminderAt
            ? getBusinessElapsedMs(lastResponseReminderAt, now)
            : Number.POSITIVE_INFINITY;
          if (
            elapsedSinceAssigned >= SLA_RESPONSE_REMINDER_MS &&
            elapsedSinceResponseReminder >= SLA_RESPONSE_REMINDER_MS
          ) {
            automationPayload.lastResponseReminderAt = serverTimestamp();
            automationLogs.push({
              id: `${Date.now()}-system-response-reminder`,
              kind: "system",
              note: "SLA reminder: no response yet. Please update this inquiry.",
              byId: "system",
              byName: "System",
              at: now.toISOString(),
            });
          }
        }
        if ((data.status ?? "new") === "responded" && assignedAgentId && canAutoReassign) {
          const elapsedSinceActivity = getBusinessElapsedMs(lastActivityAt, now);
          const lastUpdateReminderAt = data.lastUpdateReminderAt?.toDate?.();
          const elapsedSinceUpdateReminder = lastUpdateReminderAt
            ? getBusinessElapsedMs(lastUpdateReminderAt, now)
            : Number.POSITIVE_INFINITY;
          if (
            elapsedSinceActivity >= SLA_UPDATE_REMINDER_MS &&
            elapsedSinceUpdateReminder >= SLA_UPDATE_REMINDER_MS
          ) {
            automationPayload.lastUpdateReminderAt = serverTimestamp();
            automationLogs.push({
              id: `${Date.now()}-system-update-reminder`,
              kind: "system",
              note: "SLA reminder: no lead progress update in the expected window.",
              byId: "system",
              byName: "System",
              at: now.toISOString(),
            });
          }
          if (elapsedSinceActivity >= SLA_UPDATE_REASSIGN_MS && assignableAgents.length > 1) {
            const currentCount = assignmentCounts.get(assignedAgentId) ?? 0;
            assignmentCounts.set(assignedAgentId, Math.max(currentCount - 1, 0));
            const candidates = assignableAgents.filter(
              (agent) => agent.id !== assignedAgentId
            );
            if (candidates.length) {
              const minimumLoad = Math.min(
                ...candidates.map((agent) => assignmentCounts.get(agent.id) ?? 0)
              );
              const eligibleAgents = candidates.filter(
                (agent) => (assignmentCounts.get(agent.id) ?? 0) === minimumLoad
              );
              const selectedAgent =
                eligibleAgents[
                  Math.floor(Math.random() * eligibleAgents.length)
                ];
              assignedAgentId = selectedAgent.id;
              assignedAgentName =
                selectedAgent.name || selectedAgent.email || "Agent";
              assignmentCounts.set(
                selectedAgent.id,
                (assignmentCounts.get(selectedAgent.id) ?? 0) + 1
              );
              pendingAssignments.push({
                id: docSnap.id,
                assignedAgentId,
                assignedAgentName,
                assignedAtNow: true,
              });
              automationLogs.push({
                id: `${Date.now()}-system-update-reassign`,
                kind: "system",
                note: "SLA escalation: lead reassigned after prolonged inactivity.",
                byId: "system",
                byName: "System",
                at: now.toISOString(),
              });
            } else {
              assignmentCounts.set(assignedAgentId, currentCount);
            }
          }
        }
        if (automationLogs.length) {
          automationPayload.progressLogs = arrayUnion(...automationLogs);
        }
        if (Object.keys(automationPayload).length) {
          pendingAutomationUpdates.push({
            id: docSnap.id,
            payload: automationPayload,
          });
        }
        items.push({
          id: docSnap.id,
          buyer: data.buyerName || "Buyer",
          parcel: data.plotLabel || "Parcel",
          intent: "High",
          time: createdAt ? createdAt.toLocaleString() : "Just now",
          phone: data.buyerPhone || "",
          preferredContact: data.preferredContact || "Call",
          message: data.message || "",
          status: data.status ?? "new",
          assignedAgentId,
          assignedAgentName,
          respondedById: data.respondedById,
          respondedByName: data.respondedByName,
          respondedAt: data.respondedAt?.toDate
            ? data.respondedAt.toDate().toLocaleString()
            : undefined,
          assignedAt: assignedAt.toLocaleString(),
          successfulByName: data.successfulByName,
          successfulAt: successfulAtDate?.toLocaleString(),
          nextFollowUpAt: data.nextFollowUpAt,
          progressLogs: progressLogs.map((log) => ({
            id: log.id,
            kind: log.kind,
            note: log.note,
            byName: log.byName,
            at: log.at,
            ...(log.nextFollowUpAt ? { nextFollowUpAt: log.nextFollowUpAt } : {}),
            ...(log.channel ? { channel: log.channel } : {}),
          })),
          reminders,
        });
      });
      if (pendingAssignments.length) {
        try {
          await Promise.all(
            pendingAssignments.map((assignment) =>
              updateDoc(doc(db, "inquiries", assignment.id), {
                assignedAgentId: assignment.assignedAgentId,
                assignedAgentName: assignment.assignedAgentName,
                ...(assignment.assignedAtNow
                  ? { assignedAt: serverTimestamp() }
                  : {}),
                portalId: portalId ?? null,
              })
            )
          );
        } catch {
          // Keep inquiry loading non-blocking if assignment write fails.
        }
      }
      if (pendingAutomationUpdates.length) {
        try {
          await Promise.all(
            pendingAutomationUpdates.map((update) =>
              updateDoc(doc(db, "inquiries", update.id), update.payload)
            )
          );
        } catch {
          // Keep inquiry loading non-blocking if automation write fails.
        }
      }
      const visibleItems =
        isPortalAdmin || !vendorId
          ? items
          : items.filter((item) => item.assignedAgentId === vendorId);
      setInquiries(visibleItems);
    };
    loadInquiries();
  }, [
    vendorProfile?.name,
    vendorId,
    portalId,
    canViewInquiries,
    canViewLeads,
    getDashboardScopeId,
    isPortalAdmin,
    assignableAgents,
    portalMembers,
  ]);

  useEffect(() => {
    const loadVisitRequests = async () => {
      if (!canViewLeads) {
        setVisitRequests([]);
        return;
      }
      const scopeId = getDashboardScopeId();
      const activeVendorId = getActiveVendorId();
      if (!portalId && !scopeId && !activeVendorId) return;
      let snapshot;
      try {
        snapshot = portalId
          ? await getDocs(
              query(
                collection(db, "visitBookings"),
                where("portalId", "==", portalId),
                orderBy("createdAt", "desc")
              )
            )
          : await getDocs(
              query(
                collection(db, "visitBookings"),
                scopeId
                  ? where("dashboardScopeId", "==", scopeId)
                  : where("vendorId", "==", activeVendorId),
                orderBy("createdAt", "desc")
              )
            );
      } catch {
        snapshot = portalId
          ? await getDocs(
              query(collection(db, "visitBookings"), where("portalId", "==", portalId))
            )
          : await getDocs(
              query(
                collection(db, "visitBookings"),
                scopeId
                  ? where("dashboardScopeId", "==", scopeId)
                  : where("vendorId", "==", activeVendorId)
              )
            );
      }
      const mapped = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as {
          plotId?: string;
          plotLabel?: string;
          vendorName?: string;
          vendorId?: string | null;
          portalId?: string | null;
          requestedByName?: string;
          requestedByPhone?: string;
          preferredVisitAt?: string;
          note?: string;
          status?: "requested" | "visited";
          createdAt?: { toDate?: () => Date } | string;
          visitedByName?: string;
          visitedAt?: { toDate?: () => Date } | string;
        };
        const createdAtDate =
          typeof data.createdAt === "object" && data.createdAt?.toDate
            ? data.createdAt.toDate()
            : typeof data.createdAt === "string"
            ? new Date(data.createdAt)
            : null;
        const visitedAtDate =
          typeof data.visitedAt === "object" && data.visitedAt?.toDate
            ? data.visitedAt.toDate()
            : typeof data.visitedAt === "string"
            ? new Date(data.visitedAt)
            : null;
        return {
          id: docSnap.id,
          plotId: data.plotId ?? "",
          plotLabel: data.plotLabel ?? "Parcel",
          vendorName: data.vendorName ?? vendorProfile?.name ?? "Vendor",
          vendorId: data.vendorId ?? null,
          portalId: data.portalId ?? null,
          requestedByName: data.requestedByName ?? "Buyer",
          requestedByPhone: data.requestedByPhone ?? "",
          preferredVisitAt: data.preferredVisitAt ?? "",
          note: data.note ?? "",
          status: data.status ?? "requested",
          createdAtLabel: createdAtDate
            ? createdAtDate.toLocaleString()
            : "No date",
          visitedByName: data.visitedByName ?? "",
          visitedAtLabel: visitedAtDate
            ? visitedAtDate.toLocaleString()
            : undefined,
        } as VisitRequest;
      });
      setVisitRequests(mapped);
    };
    loadVisitRequests();
  }, [
    canViewLeads,
    getActiveVendorId,
    getDashboardScopeId,
    portalId,
    vendorProfile?.name,
  ]);

  const earthRadius = 6371000;
  const minGpsAccuracyMeters = 3;
  const strideLengthMeters = 0.76;
  const anchorAverageWindowMs = 30000;
  const beaconSampleWindowMs = 30000;
  const beaconAccuracyTargetMeters = 2;
  const beaconTrimRatio = 0.2;
  const stillnessWindowMs = 3000;
  const WGS84_RADIUS = 6378137;

  const calcSignalStrength = (accuracy?: number) => {
    if (!accuracy || accuracy <= 0) return 0;
    if (accuracy <= minGpsAccuracyMeters) return 100;
    return Math.max(
      0,
      Math.min(100, (minGpsAccuracyMeters / accuracy) * 100)
    );
  };

  const metersToLatDegrees = (meters: number) => meters / 111111;
  const metersToLngDegrees = (meters: number, lat: number) =>
    meters / (111111 * Math.cos(toRad(lat)) || 1);

  const kalmanUpdateAxis = (
    state: { x: number; p: number },
    measurement: number,
    measurementVariance: number,
    processVariance: number
  ) => {
    const p = state.p + processVariance;
    const k = p / (p + measurementVariance);
    return {
      x: state.x + k * (measurement - state.x),
      p: (1 - k) * p,
    };
  };

  const applyKalman = (
    parcelId: number,
    measurement: { lat: number; lng: number },
    accuracyMeters: number,
    dtSeconds: number
  ) => {
    const state = kalmanStateRef.current[parcelId];
    if (!state) {
      kalmanStateRef.current[parcelId] = {
        lat: { x: measurement.lat, p: 1 },
        lng: { x: measurement.lng, p: 1 },
      };
      return measurement;
    }
    const measurementVarLat = Math.pow(
      metersToLatDegrees(Math.max(accuracyMeters, 1)),
      2
    );
    const measurementVarLng = Math.pow(
      metersToLngDegrees(Math.max(accuracyMeters, 1), state.lat.x),
      2
    );
    const processVarLat = Math.pow(
      metersToLatDegrees(Math.max(0.5, dtSeconds * 1.5)),
      2
    );
    const processVarLng = Math.pow(
      metersToLngDegrees(Math.max(0.5, dtSeconds * 1.5), state.lat.x),
      2
    );
    const nextLat = kalmanUpdateAxis(
      state.lat,
      measurement.lat,
      measurementVarLat,
      processVarLat
    );
    const nextLng = kalmanUpdateAxis(
      state.lng,
      measurement.lng,
      measurementVarLng,
      processVarLng
    );
    kalmanStateRef.current[parcelId] = { lat: nextLat, lng: nextLng };
    return { lat: nextLat.x, lng: nextLng.x };
  };

  const requestMotionPermissions = async () => {
    if (motionPermissionRef.current) return;
    let granted = true;
    try {
      const motionPermission =
        (DeviceMotionEvent as any)?.requestPermission ?? null;
      if (typeof motionPermission === "function") {
        const response = await motionPermission.call(DeviceMotionEvent);
        granted = response === "granted";
      }
      const orientationPermission =
        (DeviceOrientationEvent as any)?.requestPermission ?? null;
      if (granted && typeof orientationPermission === "function") {
        const response = await orientationPermission.call(
          DeviceOrientationEvent
        );
        granted = response === "granted";
      }
    } catch {
      granted = false;
    }
    if (granted) {
      motionPermissionRef.current = true;
    }
  };
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

    let cancelled = false;
    loadGoogleMapsApi()
      .then((maps) => {
        if (cancelled || !mapPreviewRef.current) return;
        googleMapsApiRef.current = maps;
        if (mapPreviewInstanceRef.current) return;
        mapPreviewInstanceRef.current = new maps.Map(mapPreviewRef.current, {
          center: { lat: -1.248, lng: 36.668 },
          zoom: 14,
          mapId: googleMapId,
          mapTypeId: "hybrid",
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: true,
          gestureHandling: "greedy",
          scrollwheel: true,
          styles: reducedLabelStyles,
        });
      })
      .catch(() => {
        setMapSearchError("Google Maps failed to load.");
      });

    return () => {
      cancelled = true;
    };
  }, [mapPreviewOpen, reducedLabelStyles, googleMapId]);

  useEffect(() => {
    if (mapPreviewOpen) return;
    const maps = googleMapsApiRef.current;
    mapPreviewPolygonRef.current.forEach((polygon) => {
      if (maps) {
        maps.event.clearInstanceListeners(polygon);
      }
      polygon.setMap(null);
    });
    mapPreviewPolygonRef.current.clear();
    mapPreviewInstanceRef.current = null;
    if (mapPreviewRef.current) {
      mapPreviewRef.current.innerHTML = "";
    }
  }, [mapPreviewOpen]);

  useEffect(() => {
    const map = mapPreviewInstanceRef.current;
    const maps = googleMapsApiRef.current;
    if (!map || !maps) return;

    mapPreviewPolygonRef.current.forEach((polygon) => {
      maps.event.clearInstanceListeners(polygon);
      polygon.setMap(null);
    });
    mapPreviewPolygonRef.current.clear();

    if (!mapPreviewParcels.length) return;

    const bounds = new maps.LatLngBounds();
    mapPreviewParcels.forEach((parcel) => {
      const path = parcel.polygon.map(([lng, lat]) => ({ lat, lng }));
      path.forEach((point) => bounds.extend(point));

      const polygon = new maps.Polygon({
        map,
        paths: path,
        strokeColor: "#1f3d2d",
        strokeOpacity: 0.95,
        strokeWeight: 2,
        fillColor: "#c77d4b",
        fillOpacity: 0.3,
        draggable: true,
        clickable: true,
      });

      maps.event.addListener(polygon, "dragend", () => {
        const draggedPath = polygon.getPath();
        const nextPoints = Array.from({ length: draggedPath.getLength() }).map(
          (_, index) => {
            const point = draggedPath.getAt(index);
            return {
              lat: point.lat(),
              lng: point.lng(),
            };
          }
        );
        const normalized =
          nextPoints.length > 2 &&
          nextPoints[0].lat === nextPoints[nextPoints.length - 1].lat &&
          nextPoints[0].lng === nextPoints[nextPoints.length - 1].lng
            ? nextPoints.slice(0, -1)
            : nextPoints;
        setSubParcels((current) =>
          current.map((item) =>
            item.id === parcel.id
              ? {
                  ...item,
                  rawPath: normalized,
                  cleanPath: normalized,
                }
              : item
          )
        );
      });
      mapPreviewPolygonRef.current.set(parcel.id, polygon);
    });

    map.fitBounds(bounds, 40);
  }, [mapPreviewParcels]);

  useEffect(() => {
    if (!anchorMapOpen) return;
    if (!anchorMapRef.current) return;

    let cancelled = false;
    loadGoogleMapsApi()
      .then((maps) => {
        if (cancelled || !anchorMapRef.current) return;
        googleMapsApiRef.current = maps;
        if (!anchorMapInstanceRef.current) {
          const map = new maps.Map(anchorMapRef.current, {
            center: anchorTrueCoord
              ? { lat: anchorTrueCoord.lat, lng: anchorTrueCoord.lng }
              : { lat: -1.248, lng: 36.668 },
            zoom: anchorTrueCoord ? 18 : 14,
            mapId: googleMapId,
            mapTypeId: "hybrid",
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            zoomControl: true,
            gestureHandling: "greedy",
            scrollwheel: true,
            styles: reducedLabelStyles,
          });
          anchorMapInstanceRef.current = map;
          anchorMapClickListenerRef.current = maps.event.addListener(
            map,
            "click",
            (...args: unknown[]) => {
              const event = (args[0] ?? null) as
                | {
                    latLng?: {
                      lat: () => number;
                      lng: () => number;
                    };
                  }
                | null;
              if (!event?.latLng) return;
              const next = {
                lat: event.latLng.lat(),
                lng: event.latLng.lng(),
              };
              setAnchorTrueCoord(next);
              setAnchorStatus("Anchor landmark set.");
            }
          );
        } else if (anchorTrueCoord) {
          anchorMapInstanceRef.current.setCenter({
            lat: anchorTrueCoord.lat,
            lng: anchorTrueCoord.lng,
          });
          anchorMapInstanceRef.current.setZoom(18);
        }
      })
      .catch(() => {
        setAnchorSearchError("Google Maps failed to load.");
      });

    return () => {
      cancelled = true;
    };
  }, [anchorMapOpen, anchorTrueCoord, reducedLabelStyles, googleMapId]);

  useEffect(() => {
    if (!anchorMapOpen) return;
    if (!anchorMapInstanceRef.current) return;
    if (!anchorTrueCoord) return;
    const maps = googleMapsApiRef.current;
    if (!maps) return;
    if (!anchorMarkerRef.current) {
      anchorMarkerRef.current = new maps.Marker({
        map: anchorMapInstanceRef.current,
        position: { lat: anchorTrueCoord.lat, lng: anchorTrueCoord.lng },
        title: "Selected anchor",
      });
    } else {
      anchorMarkerRef.current.setPosition({
        lat: anchorTrueCoord.lat,
        lng: anchorTrueCoord.lng,
      });
    }
  }, [anchorTrueCoord, anchorMapOpen]);

  useEffect(() => {
    if (anchorMapOpen) return;
    if (anchorMapClickListenerRef.current) {
      anchorMapClickListenerRef.current.remove();
      anchorMapClickListenerRef.current = null;
    }
    anchorMapInstanceRef.current = null;
    if (anchorMapRef.current) {
      anchorMapRef.current.innerHTML = "";
    }
    anchorMarkerRef.current?.setMap(null);
    anchorMarkerRef.current = null;
  }, [anchorMapOpen]);

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

  const startGpsCapture = async (parcelId: number) => {
    if (!navigator.geolocation) {
      setLocationStatus("GPS not supported. Use a phone with location access.");
      return;
    }
    await requestMotionPermissions();
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    activeCaptureIdRef.current = parcelId;
    setLocationStatus(
      `Step 1: Wait for GPS <=${minGpsAccuracyMeters}m, then start walking.`
    );
    delete anchorSamplesRef.current[parcelId];
    delete kalmanStateRef.current[parcelId];
    delete lastGpsTimestampRef.current[parcelId];
    stepsUsedRef.current[parcelId] = stepsRef.current;
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
              anchorPoint: null,
              anchorLocked: false,
              anchorLocking: false,
              signalStrength: 0,
            }
          : item
      )
    );
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const accuracy = pos.coords.accuracy ?? 0;
        const signalStrength = calcSignalStrength(accuracy);
        setLocationStatus(
          accuracy
            ? `GPS ±${Math.round(
                accuracy
              )}m · Signal ${Math.round(
                signalStrength
              )}% · Keep walking to record.`
            : "GPS signal acquired. Keep walking to record."
        );
        const nextPoint = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        const timestamp = pos.timestamp || Date.now();
        setSubParcels((current) => {
          const parcel = current.find((item) => item.id === parcelId);
          if (!parcel) return current;
          const lastPoint = parcel.rawPath[parcel.rawPath.length - 1] ?? null;
          const lastTimestamp = lastGpsTimestampRef.current[parcelId];
          const dtSeconds =
            typeof lastTimestamp === "number"
              ? Math.max((timestamp - lastTimestamp) / 1000, 0)
              : 0;
          const heading = headingRef.current;
          const speed = pos.coords.speed ?? 0;
          const anchorLocked = Boolean(parcel.anchorLocked);

          if (!anchorLocked) {
            if (accuracy <= minGpsAccuracyMeters) {
              const existing = anchorSamplesRef.current[parcelId];
              const sample = existing ?? {
                start: timestamp,
                samples: [] as { lat: number; lng: number }[],
              };
              sample.samples.push(nextPoint);
              anchorSamplesRef.current[parcelId] = sample;
              const elapsed = timestamp - sample.start;
              if (elapsed >= anchorAverageWindowMs && sample.samples.length) {
                const avg = sample.samples.reduce(
                  (acc, point) => ({
                    lat: acc.lat + point.lat,
                    lng: acc.lng + point.lng,
                  }),
                  { lat: 0, lng: 0 }
                );
                const anchorPoint = {
                  lat: avg.lat / sample.samples.length,
                  lng: avg.lng / sample.samples.length,
                };
                delete anchorSamplesRef.current[parcelId];
                kalmanStateRef.current[parcelId] = {
                  lat: { x: anchorPoint.lat, p: 1 },
                  lng: { x: anchorPoint.lng, p: 1 },
                };
                lastGpsTimestampRef.current[parcelId] = timestamp;
                stepsUsedRef.current[parcelId] = stepsRef.current;
                return current.map((item) =>
                  item.id === parcelId
                    ? {
                        ...item,
                        rawPath: [anchorPoint],
                        cleanPath: [anchorPoint],
                        gpsAccuracy: accuracy,
                        signalStrength,
                        waitingForFix: false,
                        hasGoodFix: true,
                        anchorPoint,
                        anchorLocked: true,
                        anchorLocking: false,
                      }
                    : item
                );
              }
              return current.map((item) =>
                item.id === parcelId
                  ? {
                      ...item,
                      gpsAccuracy: accuracy,
                      signalStrength,
                      waitingForFix: false,
                      hasGoodFix: false,
                      anchorLocking: true,
                    }
                  : item
              );
            }
            delete anchorSamplesRef.current[parcelId];
            return current.map((item) =>
              item.id === parcelId
                ? {
                    ...item,
                    gpsAccuracy: accuracy,
                    signalStrength,
                    waitingForFix: true,
                    hasGoodFix: false,
                    anchorLocking: false,
                  }
                : item
            );
          }

          const stepsTotal = stepsRef.current;
          const stepsUsed = stepsUsedRef.current[parcelId] ?? stepsTotal;
          const stepsDelta = Math.max(0, stepsTotal - stepsUsed);
          let measurementPoint = nextPoint;
          let measurementAccuracy = accuracy;
          let usedDeadReckoning = false;

          if (accuracy > 5 && lastPoint && heading !== null) {
            const distanceMeters = stepsDelta * strideLengthMeters;
            if (distanceMeters > 0.2) {
              measurementPoint = movePoint(lastPoint, distanceMeters, heading);
              measurementAccuracy = Math.max(accuracy, 8);
              usedDeadReckoning = true;
              stepsUsedRef.current[parcelId] = stepsTotal;
            } else if (speed > 0.2 && dtSeconds > 0) {
              measurementPoint = movePoint(lastPoint, speed * dtSeconds, heading);
              measurementAccuracy = Math.max(accuracy, 6);
              usedDeadReckoning = true;
            }
          }

          if (!usedDeadReckoning && lastPoint && heading !== null && speed > 0.2 && dtSeconds > 0) {
            const projected = movePoint(lastPoint, speed * dtSeconds, heading);
            measurementPoint = smoothPoint(projected, nextPoint, accuracy);
          }

          const filteredPoint = applyKalman(
            parcelId,
            measurementPoint,
            measurementAccuracy,
            dtSeconds
          );

          lastGpsTimestampRef.current[parcelId] = timestamp;

          if (lastPoint && distance(lastPoint, filteredPoint) < 0.8) {
            return current.map((item) =>
              item.id === parcelId
                ? {
                    ...item,
                    gpsAccuracy: accuracy,
                    signalStrength,
                    waitingForFix: accuracy > 5,
                    hasGoodFix: accuracy <= 5,
                    anchorLocked: true,
                    anchorLocking: false,
                  }
                : item
            );
          }

          const nextRaw = [...parcel.rawPath, filteredPoint];
          const nextClean = simplifyPath(nextRaw, 5);
          return current.map((item) =>
            item.id === parcelId
              ? {
                  ...item,
                  rawPath: nextRaw,
                  cleanPath: nextClean,
                  gpsAccuracy: accuracy,
                  signalStrength,
                  waitingForFix: accuracy > 5,
                  hasGoodFix: accuracy <= 5,
                  anchorLocked: true,
                  anchorLocking: false,
                }
              : item
          );
        });
      },
      () => {
        setLocationStatus("GPS error. Move to open sky and try again.");
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
    delete anchorSamplesRef.current[parcelId];
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
          anchorLocked: item.anchorLocked ?? false,
          anchorLocking: false,
        };
      })
    );
  };

  const lockAnchorManually = (parcelId: number) => {
    if (!navigator.geolocation) {
      setLocationStatus("Geolocation not supported. Use a phone with GPS.");
      return;
    }
    setLocationStatus("Locking anchor... stand still for 30s.");
    const samples: { lat: number; lng: number }[] = [];
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const accuracy = pos.coords.accuracy ?? 0;
        if (accuracy > minGpsAccuracyMeters) {
          setLocationStatus(
            `Anchor needs <=${minGpsAccuracyMeters}m (now ±${Math.round(
              accuracy
            )}m). Move to open sky.`
          );
          return;
        }
        samples.push({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setSubParcels((current) =>
          current.map((item) =>
            item.id === parcelId
              ? {
                  ...item,
                  gpsAccuracy: accuracy,
                  signalStrength: calcSignalStrength(accuracy),
                  waitingForFix: false,
                  hasGoodFix: false,
                  anchorPoint: null,
                  anchorLocked: false,
                  anchorLocking: true,
                }
              : item
          )
        );
      },
      () => {
        setLocationStatus("Anchor failed. Allow GPS permissions and retry.");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
    setLocationStatus("Anchor averaging... keep still.");
    window.setTimeout(() => {
      navigator.geolocation.clearWatch(watchId);
      if (!samples.length) {
        setLocationStatus("No reliable fix. Stand still and retry.");
        return;
      }
      const avg = samples.reduce(
        (acc, point) => ({
          lat: acc.lat + point.lat,
          lng: acc.lng + point.lng,
        }),
        { lat: 0, lng: 0 }
      );
      const anchorPoint = {
        lat: avg.lat / samples.length,
        lng: avg.lng / samples.length,
      };
      kalmanStateRef.current[parcelId] = {
        lat: { x: anchorPoint.lat, p: 1 },
        lng: { x: anchorPoint.lng, p: 1 },
      };
      stepsUsedRef.current[parcelId] = stepsRef.current;
      setSubParcels((current) =>
        current.map((item) =>
          item.id === parcelId
            ? {
                ...item,
                anchorPoint,
                anchorLocked: true,
                rawPath: [anchorPoint],
                cleanPath: [anchorPoint],
                waitingForFix: false,
                hasGoodFix: true,
                anchorLocking: false,
              }
            : item
        )
      );
      setLocationStatus("Anchor locked. You can start capturing corners.");
    }, anchorAverageWindowMs);
  };

  const parsePrice = (price: string) => {
    const normalized = price.trim().toLowerCase();
    const numeric = Number(normalized.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(numeric)) return 0;
    const hasKsh = normalized.includes("ksh");
    const hasK = /\b\d+(\.\d+)?\s*k\b/.test(normalized);
    if (hasK && !hasKsh) {
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

  const parseKshInput = (value: string) =>
    Number(value.replace(/[^0-9.]/g, "")) || 0;

  const fileNameWithoutExtension = (name: string) =>
    name.replace(/\.[^/.]+$/, "");

  const toJpegBlob = (canvas: HTMLCanvasElement, quality = 0.92) =>
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
            return;
          }
          reject(new Error("Could not export image."));
        },
        "image/jpeg",
        quality
      );
    });

  const loadImageElement = (file: File) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not read image file."));
      };
      image.src = objectUrl;
    });

  const enhanceMutationImage = async (file: File) => {
    const image = await loadImageElement(file);
    const maxDimension = 2600;
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas is not available.");
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.filter = "contrast(1.05) saturate(1.06)";
    context.drawImage(image, 0, 0, width, height);
    const blob = await toJpegBlob(canvas, 0.93);
    return new File([blob], `${fileNameWithoutExtension(file.name)}.jpg`, {
      type: "image/jpeg",
    });
  };

  const generateSaleId = () => {
    const random = Math.floor(100000 + Math.random() * 900000);
    return `SALE-${random}`;
  };

  const averageCornerSamples = (samples: { lat: number; lng: number }[]) => {
    if (samples.length === 0) return null;
    const sortedLat = [...samples].map((s) => s.lat).sort((a, b) => a - b);
    const sortedLng = [...samples].map((s) => s.lng).sort((a, b) => a - b);
    const medianLat = sortedLat[Math.floor(sortedLat.length / 2)];
    const medianLng = sortedLng[Math.floor(sortedLng.length / 2)];
    const withDistance = samples
      .map((s) => ({
        ...s,
        d: distance({ lat: medianLat, lng: medianLng }, s),
      }))
      .sort((a, b) => a.d - b.d);
    const trimCount = Math.floor(withDistance.length * beaconTrimRatio);
    const trimmed =
      withDistance.length > trimCount * 2
        ? withDistance.slice(trimCount, withDistance.length - trimCount)
        : withDistance;
    const avg = trimmed.reduce(
      (acc, s) => ({
        lat: acc.lat + s.lat,
        lng: acc.lng + s.lng,
      }),
      { lat: 0, lng: 0 }
    );
    return {
      lat: avg.lat / trimmed.length,
      lng: avg.lng / trimmed.length,
    };
  };

  const calculateHri = (
    samples: number,
    lagSeconds: number,
    hdop: number,
    distanceKm: number
  ) => {
    let score = 100;
    if (samples < 120) score -= (120 - samples) * 0.25;
    if (lagSeconds > 5) score -= (lagSeconds - 5) * 0.3;
    if (hdop > 1.5) score -= (hdop - 1.5) * 10;
    if (distanceKm > 1) score -= (distanceKm - 1) * 3;
    return Math.max(0, Math.min(100, Math.round(score)));
  };

  const computeDeltaVector = (
    truth: { lat: number; lng: number },
    raw: { lat: number; lng: number }
  ) => {
    const latRad = toRad(raw.lat);
    const deltaNorth =
      (truth.lat - raw.lat) * (Math.PI / 180) * WGS84_RADIUS;
    const deltaEast =
      (truth.lng - raw.lng) *
      (Math.PI / 180) *
      WGS84_RADIUS *
      Math.cos(latRad);
    return { deltaNorth, deltaEast };
  };

  const applyDeltaVector = (
    raw: { lat: number; lng: number },
    delta: { deltaNorth: number; deltaEast: number }
  ) => {
    const latRad = toRad(raw.lat);
    const correctedLat =
      raw.lat + (delta.deltaNorth / WGS84_RADIUS) * (180 / Math.PI);
    const correctedLng =
      raw.lng +
      (delta.deltaEast / (WGS84_RADIUS * Math.cos(latRad))) *
        (180 / Math.PI);
    return { lat: correctedLat, lng: correctedLng };
  };

  const getHriStatus = (hri: number) => {
    if (hri >= 85) return { label: "High precision", tone: "text-[#1f3d2d]" };
    if (hri >= 51) return { label: "Standard precision", tone: "text-[#b26a00]" };
    return { label: "Signal unstable", tone: "text-[#b3261e]" };
  };

  const runMapSearch = async () => {
    const trimmed = mapSearchQuery.trim();
    if (!trimmed) return;
    setMapSearchLoading(true);
    setMapSearchError(null);
    try {
      const response = await fetch(`/api/google-geocode?q=${encodeURIComponent(trimmed)}`);
      if (!response.ok) {
        throw new Error("Search failed");
      }
      const data = (await response.json()) as {
        results?: { id: string; place_name: string; center: [number, number] }[];
      };
      setMapSearchResults(data.results ?? []);
    } catch {
      setMapSearchError("Search failed. Try again.");
      setMapSearchResults([]);
    } finally {
      setMapSearchLoading(false);
    }
  };

  const runAnchorSearch = async () => {
    const trimmed = anchorSearchQuery.trim();
    if (!trimmed) return;
    setAnchorSearchLoading(true);
    setAnchorSearchError(null);
    try {
      const response = await fetch(`/api/google-geocode?q=${encodeURIComponent(trimmed)}`);
      if (!response.ok) {
        throw new Error("Search failed");
      }
      const data = (await response.json()) as {
        results?: { id: string; place_name: string; center: [number, number] }[];
      };
      setAnchorSearchResults(data.results ?? []);
    } catch {
      setAnchorSearchError("Search failed. Try again.");
      setAnchorSearchResults([]);
    } finally {
      setAnchorSearchLoading(false);
    }
  };

  const startAnchorSession = async () => {
    if (!portalId) {
      setAnchorStatus("Select a portal to start anchor.");
      return;
    }
    if (!anchorTrueCoord) {
      setAnchorStatus("Tap a landmark on the map first.");
      return;
    }
    if (!navigator.geolocation) {
      setAnchorStatus("Geolocation not supported.");
      return;
    }
    const sessionId = `${portalId}-${Date.now()}`;
    setAnchorSessionId(sessionId);
    setAnchorInputSessionId(sessionId);
    setAnchorActive(true);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("activeAnchorSessionId", sessionId);
    }
    await setDoc(doc(db, "mapping_sessions", sessionId), {
      portalId,
      sessionId,
      true_landmark_coords: anchorTrueCoord,
      createdAt: serverTimestamp(),
      status: "active",
      createdBy: auth.currentUser?.uid ?? null,
    });
    const dbPath = dbRef(
      realtimeDb,
      `anchor_telemetry/${portalId}/${sessionId}`
    );
    anchorDbRef.current = dbPath;
    if (anchorWatchRef.current !== null) {
      navigator.geolocation.clearWatch(anchorWatchRef.current);
    }
    setAnchorStatus("Anchor running… stay still.");
    const deltaWindow: { deltaNorth: number; deltaEast: number }[] = [];
    let lastPushAt = 0;
    anchorWatchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const now = pos.timestamp || Date.now();
        if (now - lastPushAt < 1000) {
          return;
        }
        lastPushAt = now;
        const raw = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        const delta = computeDeltaVector(anchorTrueCoord, raw);
        deltaWindow.push(delta);
        if (deltaWindow.length > 60) {
          deltaWindow.shift();
        }
        const avg = deltaWindow.reduce(
          (acc, item) => ({
            deltaNorth: acc.deltaNorth + item.deltaNorth,
            deltaEast: acc.deltaEast + item.deltaEast,
          }),
          { deltaNorth: 0, deltaEast: 0 }
        );
        const averaged = {
          deltaNorth: avg.deltaNorth / deltaWindow.length,
          deltaEast: avg.deltaEast / deltaWindow.length,
        };
        const payload: AnchorPayload = {
          sessionId,
          measuredLat: raw.lat,
          measuredLng: raw.lng,
          deltaNorth: averaged.deltaNorth,
          deltaEast: averaged.deltaEast,
          lat: anchorTrueCoord.lat,
          lng: anchorTrueCoord.lng,
          accuracy: pos.coords.accuracy ?? 0,
          timestamp: now,
        };
        setAnchorData(payload);
        const entryRef = push(dbPath);
        dbSet(entryRef, payload);
      },
      () => {
        setAnchorStatus("Anchor GPS error. Move to open sky.");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  };

  const stopAnchorSession = () => {
    if (anchorWatchRef.current !== null) {
      navigator.geolocation.clearWatch(anchorWatchRef.current);
      anchorWatchRef.current = null;
    }
    setAnchorActive(false);
    setAnchorStatus("Anchor stopped.");
    if (anchorDbRef.current) {
      remove(anchorDbRef.current).catch(() => null);
    }
    if (anchorSessionId) {
      updateDoc(doc(db, "mapping_sessions", anchorSessionId), {
        status: "stopped",
        stoppedAt: serverTimestamp(),
      }).catch(() => null);
    }
  };

  const joinAnchorSession = () => {
    const trimmed = anchorInputSessionId.trim();
    if (!trimmed) {
      setAnchorStatus("Enter a session ID to join.");
      return;
    }
    setAnchorSessionId(trimmed);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("activeAnchorSessionId", trimmed);
    }
    setAnchorStatus(`Joined anchor session ${trimmed}.`);
  };

  const computeCornerConfidence = (
    averaged: { lat: number; lng: number },
    samples: { lat: number; lng: number }[],
    accuracy: number
  ) => {
    if (!samples.length) return 0;
    const distances = samples.map((s) => distance(averaged, s));
    const mean =
      distances.reduce((sum, value) => sum + value, 0) / distances.length;
    const variance =
      distances.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      distances.length;
    const stdDev = Math.sqrt(variance);
    const accuracyPenalty = Math.max(0, accuracy - beaconAccuracyTargetMeters) * 8;
    const dispersionPenalty = stdDev * 20;
    const raw = 100 - accuracyPenalty - dispersionPenalty;
    return Math.max(0, Math.min(100, Math.round(raw)));
  };

  const captureCorner = (parcelId: number) => {
    if (!navigator.geolocation) {
      setLocationStatus("GPS not supported. Use a phone with GPS.");
      return;
    }
    const existing = cornerSampleRef.current[parcelId];
    if (existing?.watchId !== null && existing?.watchId !== undefined) {
      navigator.geolocation.clearWatch(existing.watchId);
    }
    setLocationStatus("Step 2: Stand still. Sampling corner for 20s.");
    cornerSampleRef.current[parcelId] = {
      start: Date.now(),
      samples: [],
      watchId: null,
      received: 0,
      rejectedMotion: 0,
    };
    setSubParcels((current) =>
      current.map((item) =>
        item.id === parcelId
          ? {
              ...item,
              samplingCorner: true,
              cornerSampleCount: 0,
              cornerCountdown: Math.ceil(beaconSampleWindowMs / 1000),
            }
          : item
      )
    );
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const entry = cornerSampleRef.current[parcelId];
        if (entry) {
          entry.received += 1;
        }
        const accuracy = pos.coords.accuracy ?? 0;
        const signalStrength = calcSignalStrength(accuracy);
        const stillEnough =
          Date.now() - lastMotionTimeRef.current > stillnessWindowMs;
        if (!stillEnough) {
          if (entry) {
            entry.rejectedMotion += 1;
          }
          setLocationStatus("Hold still. Motion detected — pause and retry.");
          return;
        }
        if (accuracy > 8) {
          setLocationStatus(
            `Accuracy ±${Math.round(
              accuracy
            )}m is too weak. Wait for <=8m before sampling.`
          );
          return;
        }
        if (accuracy > beaconAccuracyTargetMeters) {
          setLocationStatus(
            `Low accuracy (±${Math.round(
              accuracy
            )}m). Capturing anyway — anchor correction will be applied.`
          );
        }
        const rawSample = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        const correctedSample =
          anchorData && anchorData.sessionId === anchorSessionId
            ? applyDeltaVector(rawSample, anchorData)
            : rawSample;
        if (entry) {
          entry.samples.push(correctedSample);
          entry.lastAccuracy = accuracy;
          const lagSeconds = anchorData
            ? Math.max((Date.now() - anchorData.timestamp) / 1000, 0)
            : 0;
          const distanceKm = anchorData
            ? distance(
                { lat: anchorData.measuredLat, lng: anchorData.measuredLng },
                rawSample
              ) / 1000
            : 0;
          const hdopProxy = Math.max(0.8, accuracy / 2);
          const hri = calculateHri(
            entry.samples.length,
            lagSeconds,
            hdopProxy,
            distanceKm
          );
          setSubParcels((current) =>
            current.map((item) =>
              item.id === parcelId
                ? {
                    ...item,
                    cornerSampleCount: entry.samples.length,
                    gpsAccuracy: accuracy,
                    signalStrength,
                    cornerHri: hri,
                  }
                : item
            )
          );
        }
      },
      () => {
        setLocationStatus("GPS error. Move to open sky and try again.");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
    cornerSampleRef.current[parcelId].watchId = watchId;
    const countdownId = window.setInterval(() => {
      setSubParcels((current) =>
        current.map((item) =>
          item.id === parcelId
            ? {
                ...item,
                cornerCountdown: Math.max((item.cornerCountdown ?? 1) - 1, 0),
              }
            : item
        )
      );
    }, 1000);
    const timeoutId = window.setTimeout(() => {
      const entry = cornerSampleRef.current[parcelId];
      if (!entry) return;
      if (entry.watchId !== null) {
        navigator.geolocation.clearWatch(entry.watchId);
      }
      window.clearInterval(countdownId);
      const averaged = averageCornerSamples(entry.samples);
      if (!averaged) {
        if (entry.received === 0) {
          setLocationStatus(
            "No GPS samples. Allow location permission and move to open sky."
          );
        } else if (entry.samples.length === 0 && entry.rejectedMotion > 0) {
          setLocationStatus(
            "Too much motion. Stand still at the corner and retry."
          );
        } else {
          setLocationStatus(
            "Signal noisy. Try again with clearer sky."
          );
        }
        setSubParcels((current) =>
          current.map((item) =>
            item.id === parcelId
              ? { ...item, samplingCorner: false }
              : item
          )
        );
        return;
      }
      const lastAccuracy = entry.lastAccuracy ?? beaconAccuracyTargetMeters;
      const cornerConfidence = computeCornerConfidence(
        averaged,
        entry.samples,
        lastAccuracy
      );
      setSubParcels((current) =>
        current.map((item) => {
          if (item.id !== parcelId) return item;
          const allConfidences = [
            ...(item.cornerConfidences ?? []),
            cornerConfidence,
          ];
          const overall = Math.round(
            allConfidences.reduce((sum, value) => sum + value, 0) /
              allConfidences.length
          );
          return {
            ...item,
            rawPath: [...item.rawPath, averaged],
            cleanPath: [...item.cleanPath, averaged],
            samplingCorner: false,
            cornerSampleCount: 0,
            cornerCountdown: 0,
            waitingForFix: false,
            hasGoodFix: true,
            lastCornerConfidence: cornerConfidence,
            cornerConfidences: allConfidences,
            overallConfidence: overall,
          };
        })
      );
      setLocationStatus("Corner saved. Move to the next beacon.");
      delete cornerSampleRef.current[parcelId];
    }, beaconSampleWindowMs);
    cornerSampleRef.current[parcelId].timeoutId = timeoutId;
  };

  const clearCorners = (parcelId: number) => {
    const entry = cornerSampleRef.current[parcelId];
    if (entry?.watchId !== null) {
      navigator.geolocation.clearWatch(entry.watchId);
    }
    if (entry?.timeoutId) {
      window.clearTimeout(entry.timeoutId);
    }
    delete cornerSampleRef.current[parcelId];
    setSubParcels((current) =>
      current.map((item) =>
        item.id === parcelId
          ? {
              ...item,
              rawPath: [],
              cleanPath: [],
              samplingCorner: false,
              cornerSampleCount: 0,
              cornerCountdown: 0,
            }
          : item
      )
    );
    setLocationStatus(null);
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
  const visiblePendingSales = useMemo(
    () =>
      isPortalAdmin || !vendorId
        ? pendingSalesRecords
        : pendingSalesRecords.filter(
            (sale) => sale.createdByAgentId === vendorId
          ),
    [isPortalAdmin, pendingSalesRecords, vendorId]
  );
  const visibleSales = useMemo(
    () =>
      isPortalAdmin || !vendorId
        ? salesRecords
        : salesRecords.filter((sale) => sale.createdByAgentId === vendorId),
    [isPortalAdmin, salesRecords, vendorId]
  );
  const agentSoldValueSoFar = visibleSales.reduce(
    (sum, sale) => sum + sale.salePrice,
    0
  );
  const agentScorecards = useMemo(() => {
    const agents = portalMembers.filter(
      (member) =>
        member.role === "agent" && (isPortalAdmin || member.id === vendorId)
    );
    const now = new Date();
    return agents.map((agent) => {
      const assigned = inquiries.filter((item) => item.assignedAgentId === agent.id);
      const respondedOrWon = assigned.filter(
        (item) =>
          (item.status ?? "new") === "responded" ||
          (item.status ?? "new") === "successful"
      );
      const won = assigned.filter((item) => (item.status ?? "new") === "successful");
      const responseMinutes = assigned
        .map((item) => {
          const assignedAt = item.assignedAt ? new Date(item.assignedAt) : null;
          const respondedAt = item.respondedAt ? new Date(item.respondedAt) : null;
          if (!assignedAt || !respondedAt) return null;
          if (
            Number.isNaN(assignedAt.getTime()) ||
            Number.isNaN(respondedAt.getTime())
          ) {
            return null;
          }
          return Math.max(
            Math.round((respondedAt.getTime() - assignedAt.getTime()) / 60000),
            0
          );
        })
        .filter((value): value is number => typeof value === "number");
      const avgResponseMinutes = responseMinutes.length
        ? Math.round(
            responseMinutes.reduce((sum, value) => sum + value, 0) /
              responseMinutes.length
          )
        : null;
      const revenueClosed = salesRecords
        .filter((sale) => sale.createdByAgentId === agent.id)
        .reduce((sum, sale) => sum + sale.salePrice, 0);
      const overdueFollowUps = assigned.filter((item) => {
        if ((item.status ?? "new") !== "responded") return false;
        if (!item.nextFollowUpAt) return false;
        const nextDate = new Date(item.nextFollowUpAt);
        if (Number.isNaN(nextDate.getTime())) return false;
        return nextDate < now;
      }).length;
      const winRate = respondedOrWon.length
        ? Math.round((won.length / respondedOrWon.length) * 100)
        : 0;
      return {
        agentId: agent.id,
        agentName: agent.name || agent.email || "Agent",
        won: won.length,
        responded: respondedOrWon.length,
        winRate,
        avgResponseMinutes,
        revenueClosed,
        overdueFollowUps,
      };
    });
  }, [inquiries, portalMembers, salesRecords, isPortalAdmin, vendorId]);

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
      const scopeId = getDashboardScopeId();
      const updated = current.map((sale) => {
        if (sale.id !== saleId) return sale;
        const nextInstallments = updater(sale.installments);
        const cleanInstallments = nextInstallments.map((installment) => {
          const cleaned = { ...installment } as SaleInstallment;
          delete cleaned.proofFile;
          if (!cleaned.proofName) delete cleaned.proofName;
          if (!cleaned.proofUrl) delete cleaned.proofUrl;
          return cleaned;
        });
        const totalPaid = nextInstallments.reduce((sum, item) => {
          const paid = parseKshInput(item.amount);
          return sum + paid;
        }, 0);
        const remainingBalance = Math.max(sale.netToVendor - totalPaid, 0);
        const fullyPaid = remainingBalance <= 0;
        if (activeVendorId && scopeId) {
          setDoc(
            doc(db, "pendingSales", sale.id),
            {
              vendorId: activeVendorId,
              portalId: portalId ?? null,
              dashboardScopeId: scopeId,
              installments: cleanInstallments,
              totalPaid,
              remainingBalance,
              fullyPaid,
            },
            { merge: true }
          );
        }
        return {
          ...sale,
          installments: cleanInstallments,
          totalPaid,
          remainingBalance,
          fullyPaid,
        };
      });
      return updated;
    });
  };

  const closePendingSale = async (sale: SalesRecord) => {
    if (!canAddSales) {
      denyAccess("Access denied. Contact admin for addition.");
      return;
    }
    const activeVendorId = getActiveVendorId();
    const scopeId = getDashboardScopeId();
    setPendingSalesRecords((current) =>
      current.filter((item) => item.id !== sale.id)
    );
    setSalesRecords((prev) => [
      {
        ...sale,
        totalPaid: sale.netToVendor,
        remainingBalance: 0,
        fullyPaid: true,
      },
      ...prev,
    ]);
    if (activeVendorId && scopeId) {
      await setDoc(doc(db, "sales", sale.id), {
        vendorId: activeVendorId,
        portalId: portalId ?? null,
        dashboardScopeId: scopeId,
        createdByAgentId: sale.createdByAgentId ?? vendorId ?? activeVendorId,
        createdByAgentName:
          sale.createdByAgentName ?? userDisplayName ?? "Agent",
        ...serializeSaleRecordForFirestore({
          ...sale,
          totalPaid: sale.netToVendor,
          remainingBalance: 0,
          fullyPaid: true,
        }),
        totalPaid: sale.netToVendor,
        remainingBalance: 0,
        fullyPaid: true,
        createdAt: serverTimestamp(),
      });
      await deleteDoc(doc(db, "pendingSales", sale.id));
    }
  };

  const submitPendingInstallment = async (saleId: string) => {
    if (!canAddSales) {
      denyAccess("Access denied. Contact admin for addition.");
      return;
    }
    const draft = installmentDrafts[saleId];
    if (!draft) return;
    const amount = parseKshInput(draft.amount);
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

  const refreshSoldParcelOverlays = useCallback(
    async (plot: VendorPlot, soldParcelIds: number[]) => {
      if (!plot.mutationFormUrl || !soldParcelIds.length) return;
      if (plot.mutationFormUrl.toLowerCase().includes(".pdf")) return;
      try {
        const response = await fetch("/api/mutation-overlay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mutationFormUrl: plot.mutationFormUrl,
            soldParcelIds,
          }),
        });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          overlays?: MutationParcel[];
        };
        const nextOverlays = (payload.overlays ?? [])
          .map((overlay) => ({
            parcelNumber: Math.trunc(Number(overlay.parcelNumber)),
            confidence:
              typeof overlay.confidence === "number"
                ? overlay.confidence
                : undefined,
            points: (overlay.points ?? [])
              .map((point) => ({
                x: Number(point.x),
                y: Number(point.y),
              }))
              .filter(
                (point) => Number.isFinite(point.x) && Number.isFinite(point.y)
              ),
          }))
          .filter(
            (overlay) =>
              soldParcelIds.includes(overlay.parcelNumber) &&
              overlay.points.length >= 3
          );
        if (!nextOverlays.length) return;

        const merged = [
          ...(plot.soldParcelOverlays ?? []).filter(
            (item) =>
              !nextOverlays.some(
                (overlay) => overlay.parcelNumber === item.parcelNumber
              )
          ),
          ...nextOverlays,
        ].sort((a, b) => a.parcelNumber - b.parcelNumber);

        await updateDoc(doc(db, "listings", plot.id), {
          soldParcelOverlays: merged,
          updatedAt: serverTimestamp(),
        });
        setPlots((current) =>
          current.map((item) =>
            item.id === plot.id ? { ...item, soldParcelOverlays: merged } : item
          )
        );
      } catch {
        // sold state should still succeed if overlay refresh fails
      }
    },
    []
  );

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

        const persistSale = async () => {
          try {
            await updateDoc(doc(db, "listings", plotId), {
              soldParcelIds: updatedSold,
              availableParcels,
              updatedAt: serverTimestamp(),
            });
            await refreshSoldParcelOverlays(plot, updatedSold);
          } catch {
            // Keep local state even if persistence fails.
          }
        };
        persistSale();

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
    if (!canAddSales) {
      denyAccess("Access denied. Contact admin for addition.");
      return;
    }
    const plot = plots.find((item) => item.id === plotId);
    if (!plot) return;
    setSaleDraft({
      plotId,
      parcelIndex,
      parcelName: plot.name,
      defaultPrice: plot.price,
    });
    setBuyerNameInput("");
    setSalePriceInput(formatKshInput(plot.price));
    setCharges([]);
    setInstallments([]);
    setSaleType("cash");
    setNextPaymentDate("");
    setSaleAttachments([]);
    setSaleModalOpen(true);
  };

  const confirmSale = async () => {
    if (!canAddSales) {
      denyAccess("Access denied. Contact admin for addition.");
      return;
    }
    if (!saleDraft) return;
    const activeVendorId = getActiveVendorId();
    const scopeId = getDashboardScopeId();
    const salePrice = parseKshInput(salePriceInput);
    const totalDeductions = charges.reduce((sum, charge) => {
      const fee = parseKshInput(charge.amount);
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
              proofFile: null,
            },
          ]
        : installments;
    const totalPaid = normalizedInstallments.reduce((sum, installment) => {
      const paid = parseKshInput(installment.amount);
      return sum + paid;
    }, 0);
    const remainingBalance = Math.max(netToVendor - totalPaid, 0);

    const saleId = generateSaleId();
    const createdByAgentId = vendorId ?? activeVendorId ?? "";
    const createdByAgentName = userDisplayName ?? "Agent";
    let uploadedInstallments = normalizedInstallments.map((installment) => {
      const cleaned = { ...installment };
      delete cleaned.proofFile;
      return cleaned;
    });
    if (activeVendorId && normalizedInstallments.length) {
      uploadedInstallments = await Promise.all(
        normalizedInstallments.map(async (installment) => {
          if (!installment.proofFile) {
            const rest = { ...installment };
            delete rest.proofFile;
            return rest;
          }
          const fileRef = ref(
            storage,
            `vendors/${activeVendorId}/sales/${saleId}/installments/${installment.id}-${installment.proofFile.name}`
          );
          try {
            await uploadBytes(fileRef, installment.proofFile);
            const url = await getDownloadURL(fileRef);
            const rest = { ...installment };
            delete rest.proofFile;
            return {
              ...rest,
              proofName: installment.proofFile.name,
              proofUrl: url,
            };
          } catch {
            const rest = { ...installment };
            delete rest.proofFile;
            return {
              ...rest,
              proofName: installment.proofFile.name,
            };
          }
        })
      );
    }
    let uploadedAttachments: {
      label: string;
      name: string;
      url?: string;
    }[] = [];
    if (saleAttachments.length && activeVendorId) {
      uploadedAttachments = await Promise.all(
        saleAttachments.map(async (attachment) => {
          if (!attachment.file) {
            return {
              label: attachment.label || "Attachment",
              name: attachment.name,
            };
          }
          const fileRef = ref(
            storage,
            `vendors/${activeVendorId}/sales/${saleId}-${attachment.file.name}`
          );
          try {
            await uploadBytes(fileRef, attachment.file);
            const url = await getDownloadURL(fileRef);
            return {
              label: attachment.label || attachment.file.name,
              name: attachment.file.name,
              url,
            };
          } catch {
            return {
              label: attachment.label || attachment.file.name,
              name: attachment.file.name,
            };
          }
        })
      );
    } else if (saleAttachments.length) {
      uploadedAttachments = saleAttachments
        .filter((attachment) => attachment.name)
        .map((attachment) => ({
          label: attachment.label || "Attachment",
          name: attachment.name,
        }));
    }

    const newRecord: SalesRecord = {
      id: saleId,
      parcelName: saleDraft.parcelName,
      parcelId: saleDraft.plotId,
      buyer: buyerNameInput || "Buyer",
      salePrice,
      processingFee: totalDeductions,
      netToVendor,
      totalPaid,
      remainingBalance,
      installments: uploadedInstallments,
      soldOn: "Sold today",
      createdByAgentId,
      createdByAgentName,
      ...(nextPaymentDate ? { nextPaymentDate } : {}),
      ...(uploadedAttachments.length ? { attachments: uploadedAttachments } : {}),
    };
    if (remainingBalance > 0) {
      setPendingSalesRecords((current) => [newRecord, ...current]);
      if (activeVendorId && scopeId) {
        setDoc(doc(db, "pendingSales", newRecord.id), {
          vendorId: activeVendorId,
          portalId: portalId ?? null,
          dashboardScopeId: scopeId,
          ...serializeSaleRecordForFirestore(newRecord),
          createdAt: serverTimestamp(),
        });
      }
    } else {
      setSalesRecords((current) => [newRecord, ...current]);
      if (activeVendorId && scopeId) {
        setDoc(doc(db, "sales", newRecord.id), {
          vendorId: activeVendorId,
          portalId: portalId ?? null,
          dashboardScopeId: scopeId,
          ...serializeSaleRecordForFirestore(newRecord),
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
    const scopeId = getDashboardScopeId();
    if (!activeVendorId || !scopeId) return;
    setDraftSaving(true);
    try {
      if (!draftId) {
        const docRef = await addDoc(collection(db, "draftListings"), {
          vendorId: activeVendorId,
          portalId: portalId ?? null,
          dashboardScopeId: scopeId,
          name: listingParcel,
          acres: listingSize,
          price: normalizeKshPrice(listingPrice),
          parcelCount: Math.max(1, Number.parseInt(listingParcelCount, 10) || 1),
          amenities: listingAmenities,
          step: nextStep,
          mutationForm: mutationFormUrl
            ? { name: mutationFormName, url: mutationFormUrl }
            : null,
          mutationParcels,
          plotLocation: anchorTrueCoord ?? null,
          surroundingImages: surroundingImages.map((image) => ({
            name: image.name,
            url: image.url,
          })),
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        });
        setDraftId(docRef.id);
        await loadDraftsForScope(scopeId);
      } else {
        await updateDoc(doc(db, "draftListings", draftId), {
          vendorId: activeVendorId,
          portalId: portalId ?? null,
          dashboardScopeId: scopeId,
          name: listingParcel,
          acres: listingSize,
          price: normalizeKshPrice(listingPrice),
          parcelCount: Math.max(1, Number.parseInt(listingParcelCount, 10) || 1),
          amenities: listingAmenities,
          step: nextStep,
          mutationForm: mutationFormUrl
            ? { name: mutationFormName, url: mutationFormUrl }
            : null,
          mutationParcels,
          plotLocation: anchorTrueCoord ?? null,
          surroundingImages: surroundingImages.map((image) => ({
            name: image.name,
            url: image.url,
          })),
          updatedAt: serverTimestamp(),
        });
        await loadDraftsForScope(scopeId);
      }
    } finally {
      setDraftSaving(false);
    }
  };

  const finishListing = async () => {
    if (!validateListingStepOne()) return;
    if (!validateListingStepTwo()) {
      setListingStep(2);
      return;
    }
    if (!validateListingStepThree()) {
      setListingStep(3);
      return;
    }
    const activeVendorId = getActiveVendorId();
    const scopeId = getDashboardScopeId();
    if (!activeVendorId || !scopeId) return;
    const parcelCount = Math.max(1, Number.parseInt(listingParcelCount, 10) || 1);
    setDraftSaving(true);
    try {
      const listingPayload = {
        vendorId: activeVendorId,
        portalId: portalId ?? null,
        dashboardScopeId: scopeId,
        createdBy: vendorId ?? null,
        vendorName: vendorProfile?.name ?? "Vendor",
        vendorType: vendorProfile?.type ?? "Individual",
        name: listingParcel,
        acres: listingSize,
        price: normalizeKshPrice(listingPrice),
        amenities: listingAmenities,
        mutationForm: {
          name: mutationFormName,
          url: mutationFormUrl,
        },
        mutationParcels,
        soldParcelOverlays: [],
        plotLocation: anchorTrueCoord,
        surroundingImages: surroundingImages.map((image) => ({
          name: image.name,
          url: image.url,
        })),
        parcelCount,
        parcels: Array.from({ length: parcelCount }, (_, idx) => ({
          name: parcelCount > 1 ? `Parcel ${idx + 1}` : listingParcel || "Parcel 1",
          rawPath: [],
          cleanPath: [],
        })),
        createdAt: serverTimestamp(),
      };
      const docRef = await addDoc(collection(db, "listings"), listingPayload);
      const totalParcels = parcelCount;
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
          mutationFormUrl,
          mutationFormName,
          mutationParcels,
          soldParcelOverlays: [],
          parcelNumbers:
            mutationParcels.length > 0
              ? mutationParcels.map((parcel) => parcel.parcelNumber)
              : Array.from({ length: totalParcels }, (_, idx) => idx + 1),
        },
        ...current,
      ]);
      if (draftId) {
        await deleteDoc(doc(db, "draftListings", draftId));
        setDraftId(null);
      }
      await loadDraftsForScope(scopeId);
      setNewListingOpen(false);
    } finally {
      setDraftSaving(false);
    }
  };

  const validateListingStepOne = () => {
    const nameOk = listingParcel.trim().length > 0;
    const sizeOk = listingSize.trim().length > 0;
    const priceOk = normalizeKshPrice(listingPrice).trim().length > 0;
    const parcelCountOk = (Number.parseInt(listingParcelCount, 10) || 0) > 0;
    if (!nameOk || !sizeOk || !priceOk || !parcelCountOk) {
      setListingStepError(
        "Fill in parcel name, size, price, and number of parcels to continue."
      );
      return false;
    }
    setListingStepError(null);
    return true;
  };

  const validateListingStepTwo = () => {
    if (!mutationFormUrl || !anchorTrueCoord) {
      setListingStepError(
        "Upload the mutation form and pick the plot location on satellite map."
      );
      return false;
    }
    setListingStepError(null);
    return true;
  };

  const validateListingStepThree = () => {
    if (surroundingImages.length === 0) {
      setListingStepError("Upload at least one surrounding image.");
      return false;
    }
    setListingStepError(null);
    return true;
  };

  return userLoaded ? (
    <div className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_12%_10%,_rgba(209,167,65,0.22),_transparent_28%),radial-gradient(circle_at_88%_12%,_rgba(74,160,255,0.2),_transparent_34%),linear-gradient(120deg,_#050b1a_0%,_#07122a_45%,_#091631_100%)] text-[#e8eefc]">
      <header className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="text-left">
          <p className="text-xs uppercase tracking-[0.35em] text-[#d1a741]">
            Vendor workspace
          </p>
          <h1
            className="mt-2 font-serif text-2xl text-[#f2f6ff] sm:text-3xl"
            suppressHydrationWarning
          >
            {greetingText}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <button
            type="button"
            onClick={() => handleTabChange("members")}
            disabled={!canManageMembers}
            className="rounded-full border border-[#4a78c7]/60 bg-[#09142b]/70 px-4 py-2 text-[#d6e5ff] transition hover:border-[#6f9df0] disabled:opacity-60 lg:hidden"
          >
            Members
          </button>
          <button
            className="rounded-full border border-[#4a78c7]/60 bg-[#09142b]/70 px-4 py-2 text-[#d6e5ff] transition hover:border-[#6f9df0]"
            onClick={() => {
              if (!canViewLeads) {
                denyAccess("Access denied. Contact admin for addition.");
              }
            }}
            disabled={!canViewLeads}
          >
            Export leads
          </button>
          {canCreateListings && (
            <button
              className="rounded-full bg-[#d1a741] px-5 py-2 text-[#091631] transition hover:bg-[#dfbc66]"
              onClick={() => {
                setDraftId(null);
                setListingParcel("");
                setListingSize("");
                setListingPrice("");
                setListingParcelCount("1");
                setListingAmenities([]);
                setListingStep(1);
                setListingStepError(null);
                setMutationFormName("");
                setMutationFormUrl("");
                setMutationParcels([]);
                setAnchorTrueCoord(null);
                setSurroundingImages([]);
                setNewListingOpen(true);
              }}
            >
              New listing
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              window.location.href = "/portal";
            }}
            className="rounded-full border border-[#4a78c7]/60 bg-[#09142b]/70 px-4 py-2 text-[#d6e5ff] transition hover:border-[#6f9df0]"
          >
            Back to portals
          </button>
          <button
            type="button"
            onClick={() => {
              window.location.href = "/";
            }}
            className="rounded-full border border-[#4a78c7]/60 bg-[#09142b]/70 px-4 py-2 text-[#d6e5ff] transition hover:border-[#6f9df0]"
          >
            Logout
          </button>
        </div>
      </header>

      {accessDenied && (
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-[#6a2f2f] bg-[#211419] px-4 py-3 text-[11px] text-[#ffb4ab]">
            <span>{accessDenied}</span>
            <button
              type="button"
              onClick={() => setAccessDenied(null)}
              className="rounded-full border border-[#8a4c4c] px-3 py-1 text-[10px]"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto grid max-w-6xl gap-6 px-4 pb-24 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="space-y-6">
          <section className="rounded-3xl border border-[#284675] bg-[#0a1834]/88 p-5 shadow-[0_25px_70px_-45px_rgba(0,0,0,0.9)]">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0d1f3f] text-lg font-semibold text-[#f6f9ff]">
                {(userDisplayName || "AD")
                  .split(" ")
                  .slice(0, 2)
                  .map((part) => part[0]?.toUpperCase())
                  .join("")}
              </div>
              <div>
                <p
                  className="text-sm font-semibold text-[#f2f6ff]"
                  suppressHydrationWarning
                >
                  {userDisplayName}
                </p>
                <p
                  className="text-xs text-[#c6d6f7]"
                  suppressHydrationWarning
                >
                  {portalDisplayName} · {portalLocation}
                </p>
              </div>
            </div>
            <div className="mt-6 space-y-3 text-xs">
              {[
                { label: "Active plots", value: String(plots.length) },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between rounded-2xl border border-[#284675] bg-[#09142b]/70 px-4 py-3"
                >
                  <span className="text-[#9eb6e1]">{item.label}</span>
                  <span className="font-semibold text-[#f2f6ff]">
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-[#284675] bg-[#0a1834]/88 p-5 lg:block hidden">
          
            <div className="mt-4 space-y-3 text-sm font-medium">
              {[
                { id: "active", label: "Active listings" },
                { id: "drafts", label: "Drafts" },
                { id: "inquiries", label: "Inquiries" },
                { id: "leads", label: "Leads" },
                { id: "visits", label: "Site visits" },
                { id: "pending", label: "Pending sales" },
                { id: "sales", label: "Sales" },
                { id: "members", label: "Members" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() =>
                    handleTabChange(
                      tab.id as
                        | "active"
                        | "drafts"
                        | "inquiries"
                        | "leads"
                        | "visits"
                        | "pending"
                        | "sales"
                        | "members"
                    )
                  }
                  className={`w-full rounded-2xl px-4 py-3 text-left transition ${
                    activeTab === tab.id
                      ? "bg-[#2454a0] text-white"
                      : "border border-[#284675] bg-[#09142b]/70 text-[#c6d6f7]"
                  } ${
                    canAccessTab(tab.id)
                      ? ""
                      : "cursor-not-allowed opacity-60"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-[#284675] bg-[#0a1834]/88 p-5 lg:block hidden">
            <p className="text-xs uppercase tracking-[0.35em] text-[#d1a741]">
              Branding
            </p>
            <p className="mt-2 text-xs text-[#c6d6f7]">
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
                className="text-xs text-[#c6d6f7] file:mr-3 file:rounded-full file:border-0 file:bg-[#c77d4b] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
              />
              {vendorLogo ? (
                <div className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-[10px] text-[#d6e5ff]">
                  Logo uploaded
                </div>
              ) : (
                <div className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-[10px] text-[#d6e5ff]">
                  No logo yet
                </div>
              )}
            </div>
          </section>
        </aside>

        <section className="space-y-6">
          <div className="rounded-3xl border border-[#284675] bg-[#0a1834]/88 p-5 min-h-[520px]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[#d1a741]">
                  {activeTab === "active"
                    ? "My plots"
                    : activeTab === "drafts"
                    ? "Drafts"
                    : activeTab === "inquiries"
                    ? "Inquiries"
                    : activeTab === "leads"
                    ? "Leads"
                    : activeTab === "visits"
                    ? "Site visits"
                    : activeTab === "pending"
                    ? "Pending sales"
                    : activeTab === "members"
                    ? "Members"
                    : "Sales"}
                </p>
                <h2 className="mt-2 font-serif text-2xl text-[#f2f6ff]">
                  {activeTab === "active"
                    ? "Active listings"
                    : activeTab === "drafts"
                    ? "Draft listings"
                    : activeTab === "inquiries"
                    ? "Latest inquiries"
                    : activeTab === "leads"
                    ? "Responded leads"
                    : activeTab === "visits"
                    ? "Site visit requests"
                    : activeTab === "pending"
                    ? "Pending sales"
                    : activeTab === "members"
                    ? "Portal members"
                    : "Sales records"}
                </h2>
              </div>
              {isPortalAdmin ? (
                <button
                  type="button"
                  onClick={() => {
                    const query = portalId ? `?portalId=${portalId}` : "";
                    window.location.href = `/vendor/overview${query}`;
                  }}
                  className="rounded-full border border-[#4a78c7]/60 bg-[#09142b]/70 px-4 py-2 text-xs font-medium text-[#d6e5ff] transition hover:border-[#6f9df0]"
                >
                  Overview
                </button>
              ) : (
                <button className="rounded-full border border-[#4a78c7]/60 bg-[#09142b]/70 px-4 py-2 text-xs font-medium text-[#d6e5ff] transition hover:border-[#6f9df0]">
                  View all
                </button>
              )}
            </div>

            {isPortalAdmin && (
              <div className="mt-4 grid gap-3 rounded-2xl border border-[#284675] bg-[#09142b]/70 px-4 py-3 text-xs md:grid-cols-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.25em] text-[#d1a741]">
                    Total posted value
                  </p>
                  <p className="mt-2 text-sm font-semibold text-[#f2f6ff]">
                    Ksh {totalPostedValue.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.25em] text-[#d1a741]">
                    Existing value
                  </p>
                  <p className="mt-2 text-sm font-semibold text-[#f2f6ff]">
                    Ksh {totalExistingValue.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.25em] text-[#d1a741]">
                    Sold value
                  </p>
                  <p className="mt-2 text-sm font-semibold text-[#f2f6ff]">
                    Ksh {totalSoldValue.toLocaleString()}
                  </p>
                </div>
              </div>
            )}
            {!isPortalAdmin &&
              (activeTab === "pending" || activeTab === "sales") && (
                <div className="mt-4 rounded-2xl border border-[#284675] bg-[#09142b]/70 px-4 py-3 text-xs">
                  <p className="text-[10px] uppercase tracking-[0.25em] text-[#d1a741]">
                    Your sold summary
                  </p>
                  <p className="mt-2 text-sm font-semibold text-[#f2f6ff]">
                    Ksh {agentSoldValueSoFar.toLocaleString()}
                  </p>
                </div>
              )}

            {activeTab === "active" && (
              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div className="order-2 space-y-3 text-sm lg:order-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setSearchVisible((current) => ({
                          ...current,
                          active: !current.active,
                        }))
                      }
                      className="rounded-full border border-[#365a94] bg-[#09142b]/70 px-3 py-1 text-[11px] text-[#d6e5ff]"
                    >
                      {searchVisible.active ? "Hide search" : "Search"}
                    </button>
                    {searchVisible.active && (
                      <input
                        type="text"
                        value={searchText.active}
                        onChange={(event) =>
                          setSearchText((current) => ({
                            ...current,
                            active: event.target.value,
                          }))
                        }
                        placeholder="Search listings..."
                        className="w-full rounded-2xl border border-[#365a94] bg-[#0d1f3f] px-3 py-2 text-xs text-[#e8eefc] sm:w-64"
                      />
                    )}
                  </div>
                  {plots
                    .filter((plot) =>
                      searchText.active
                        ? `${plot.id} ${plot.name} ${plot.acres} ${plot.price}`
                            .toLowerCase()
                            .includes(searchText.active.toLowerCase())
                        : true
                    )
                    .map((plot) => {
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
                            : "border-[#365a94] bg-[#09142b]/70"
                        }`}
                      >
                        <div>
                          <p className="text-xs uppercase tracking-[0.3em] text-[#d1a741]">
                            {plot.id}
                          </p>
                          <p className="mt-1 font-semibold text-[#f2f6ff]">
                            {plot.name}
                          </p>
                          <p className="mt-1 text-xs text-[#c6d6f7]">
                            {plot.acres} · {plot.price}
                          </p>
                          {totalParcels > 1 && (
                            <p className="mt-1 text-[11px] text-[#d6e5ff]">
                              Parcels: {availableParcels} available of{" "}
                              {totalParcels}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="rounded-full border border-[#365a94] bg-[#09142b]/70 px-3 py-1 text-[#1f3d2d]">
                            {plot.status}
                          </span>
                          <span className="rounded-full border border-[#284675] bg-[#09142b]/70 px-3 py-1 text-[#9eb6e1]">
                            {plot.confidence} confidence
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="order-1 rounded-3xl border border-[#284675] bg-[#09142b]/70 p-4 text-xs lg:order-2">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-[#d1a741]">
                    Details
                  </p>
                  {selectedPlot ? (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-semibold text-[#f2f6ff]">
                        {selectedPlot.name}
                      </p>
                      <p className="text-[#c6d6f7]">
                        {selectedPlot.acres} · {selectedPlot.price}
                      </p>
                      <p className="text-[#c6d6f7]">
                        Status: {selectedPlot.status}
                      </p>
                      {selectedPlot.totalParcels && (
                        <p className="text-[#d6e5ff]">
                          Parcels:{" "}
                          {selectedPlot.availableParcels ??
                            selectedPlot.totalParcels -
                              (selectedPlot.soldParcelIds?.length ?? 0)}{" "}
                          available of {selectedPlot.totalParcels}
                        </p>
                      )}
                      {selectedPlot.totalParcels && (
                        <div className="space-y-2">
                          {(() => {
                            const selectableParcels =
                              selectedPlot.parcelNumbers?.length
                                ? selectedPlot.parcelNumbers
                                : Array.from(
                                    { length: selectedPlot.totalParcels },
                                    (_, idx) => idx + 1
                                  );
                            return (
                              <>
                          <p className="text-[11px] text-[#c6d6f7]">
                            Select a parcel to mark as sold. Nodes are shared
                            across parcels.
                          </p>
                          <div className="flex flex-wrap gap-2">
                                  {selectableParcels.map((parcelNo) => {
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
                                      ? "cursor-not-allowed bg-[#eadfce] text-[#9eb6e1]"
                                      : isSelected
                                      ? "bg-[#2454a0] text-white"
                                      : "border border-[#284675] bg-[#09142b]/70 text-[#c6d6f7]"
                                  }`}
                                >
                                  Parcel {parcelNo}
                                </button>
                              );
                                  })}
                          </div>
                              </>
                            );
                          })()}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          openSaleModal(selectedPlot.id, selectedParcelIndex)
                        }
                        className="mt-3 w-full rounded-full bg-[#2454a0] px-3 py-2 text-[11px] font-semibold text-white"
                        disabled={
                          !canAddSales ||
                          (selectedPlot.totalParcels && selectedPlot.totalParcels > 1
                            ? selectedParcelIndex === null
                            : false)
                        }
                      >
                        Record sale
                      </button>
                    </div>
                  ) : (
                    <p className="mt-3 text-[#c6d6f7]">
                      Select a listing to view details.
                    </p>
                  )}
                </div>
              </div>
            )}

            {activeTab === "drafts" && (
              <div className="mt-5 space-y-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSearchVisible((current) => ({
                        ...current,
                        drafts: !current.drafts,
                      }))
                    }
                    className="rounded-full border border-[#365a94] bg-[#09142b]/70 px-3 py-1 text-[11px] text-[#d6e5ff]"
                  >
                    {searchVisible.drafts ? "Hide search" : "Search"}
                  </button>
                  {searchVisible.drafts && (
                    <input
                      type="text"
                      value={searchText.drafts}
                      onChange={(event) =>
                        setSearchText((current) => ({
                          ...current,
                          drafts: event.target.value,
                        }))
                      }
                      placeholder="Search drafts..."
                      className="w-full rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-xs text-[#f2f6ff] sm:w-64"
                    />
                  )}
                </div>
                {draftListings
                  .filter((draft) =>
                    searchText.drafts
                      ? `${draft.id} ${draft.name} ${draft.acres} ${draft.price}`
                          .toLowerCase()
                          .includes(searchText.drafts.toLowerCase())
                      : true
                  )
                  .map((draft) => (
                  <button
                    key={draft.id}
                    type="button"
                    onClick={async () => {
                      setListingParcel(draft.name);
                      setListingSize(draft.acres);
                      setListingPrice(draft.price);
                      setListingParcelCount("1");
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
                          parcelCount?: number;
                          mutationForm?: { name?: string; url?: string } | null;
                          mutationParcels?: MutationParcel[];
                          plotLocation?: { lat?: number; lng?: number } | null;
                          surroundingImages?: { name?: string; url?: string }[];
                        };
                        setListingParcelCount(
                          String(
                            Math.max(1, Number(data.parcelCount) || 1)
                          )
                        );
                        setMutationFormName(data.mutationForm?.name ?? "");
                        setMutationFormUrl(data.mutationForm?.url ?? "");
                        setMutationParcels(
                          (data.mutationParcels ?? [])
                            .map((parcel) => ({
                              parcelNumber: Math.trunc(Number(parcel.parcelNumber)),
                              confidence:
                                typeof parcel.confidence === "number"
                                  ? parcel.confidence
                                  : undefined,
                              points: (parcel.points ?? [])
                                .map((point) => ({
                                  x: Number(point.x),
                                  y: Number(point.y),
                                }))
                                .filter(
                                  (point) =>
                                    Number.isFinite(point.x) &&
                                    Number.isFinite(point.y)
                                ),
                            }))
                            .filter(
                              (parcel) =>
                                parcel.parcelNumber > 0 &&
                                parcel.points.length >= 3
                            )
                        );
                        if (
                          typeof data.plotLocation?.lat === "number" &&
                          typeof data.plotLocation?.lng === "number"
                        ) {
                          setAnchorTrueCoord({
                            lat: data.plotLocation.lat,
                            lng: data.plotLocation.lng,
                          });
                        } else {
                          setAnchorTrueCoord(null);
                        }
                        setSurroundingImages(
                          (data.surroundingImages ?? [])
                            .filter((img) => !!img?.url)
                            .map((img, idx) => ({
                              id: Date.now() + idx,
                              name: img.name || `Surrounding ${idx + 1}`,
                              url: img.url as string,
                            }))
                        );
                        }
                      }
                      setNewListingOpen(true);
                    }}
                    className="flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#284675] bg-[#09142b]/70 px-4 py-3 text-left transition hover:border-[#c9b8a6]"
                  >
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-[#d1a741]">
                        {draft.id}
                      </p>
                      <p className="mt-1 font-semibold text-[#f2f6ff]">
                        {draft.name}
                      </p>
                      <p className="mt-1 text-xs text-[#c6d6f7]">
                        {draft.acres} · {draft.price}
                      </p>
                    </div>
                    <span className="rounded-full border border-[#284675] bg-[#09142b]/70 px-3 py-1 text-xs text-[#9eb6e1]">
                      {draft.updated}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {activeTab === "inquiries" && (
              <div className="mt-5 space-y-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSearchVisible((current) => ({
                        ...current,
                        inquiries: !current.inquiries,
                      }))
                    }
                    className="rounded-full border border-[#365a94] bg-[#09142b]/70 px-3 py-1 text-[11px] text-[#d6e5ff]"
                  >
                    {searchVisible.inquiries ? "Hide search" : "Search"}
                  </button>
                  {searchVisible.inquiries && (
                    <input
                      type="text"
                      value={searchText.inquiries}
                      onChange={(event) =>
                        setSearchText((current) => ({
                          ...current,
                          inquiries: event.target.value,
                        }))
                      }
                      placeholder="Search inquiries..."
                      className="w-full rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-xs text-[#f2f6ff] sm:w-64"
                    />
                  )}
                </div>
                {inquiries
                  .filter((lead) =>
                    searchText.inquiries
                      ? `${lead.id} ${lead.buyer} ${lead.parcel} ${lead.phone}`
                          .toLowerCase()
                          .includes(searchText.inquiries.toLowerCase())
                      : true
                  )
                  .filter((lead) => (lead.status ?? "new") === "new")
                  .map((lead) => (
                  <button
                    key={lead.id}
                    type="button"
                    onClick={() => setSelectedInquiryId(lead.id)}
                    className={`flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                      selectedInquiryId === lead.id
                        ? "border-[#1f3d2d] bg-[#f7f2ea]"
                        : "border-[#365a94] bg-[#09142b]/70"
                    }`}
                  >
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-[#d1a741]">
                        {lead.id}
                      </p>
                      <p className="mt-1 font-semibold text-[#f2f6ff]">
                        {lead.buyer}
                      </p>
                      <p className="mt-1 text-xs text-[#c6d6f7]">
                        {lead.parcel}
                      </p>
                      {lead.assignedAgentName && (
                        <p className="mt-1 text-[10px] text-[#9eb6e1]">
                          Assigned to: {lead.assignedAgentName}
                        </p>
                      )}
                    </div>
                    <div className="text-right text-xs">
                      <p className="text-[#1f3d2d]">{lead.intent} intent</p>
                      <p className="text-[#9eb6e1]">{lead.time}</p>
                    </div>
                  </button>
                ))}
                <div className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-4 py-4 text-xs">
                  {selectedInquiryId ? (
                    (() => {
                      const inquiry = inquiries.find(
                        (item) => item.id === selectedInquiryId
                      );
                      if (!inquiry) return null;
                      return (
                        <div className="space-y-2">
                          <p className="text-[10px] uppercase tracking-[0.3em] text-[#d1a741]">
                            Inquiry details
                          </p>
                          <p className="text-sm font-semibold text-[#f2f6ff]">
                            {inquiry.buyer} · {inquiry.parcel}
                          </p>
                          <p className="text-[#c6d6f7]">
                            Preferred contact: {inquiry.preferredContact}
                          </p>
                          <p className="text-[#c6d6f7]">
                            Phone: {inquiry.phone}
                          </p>
                          {inquiry.assignedAgentName && (
                            <p className="text-[#c6d6f7]">
                              Assigned to: {inquiry.assignedAgentName}
                            </p>
                          )}
                          {isPortalAdmin && (
                            <p className="text-[#c6d6f7]">
                              Responded by:{" "}
                              {inquiry.respondedByName || "Not responded yet"}
                            </p>
                          )}
                          <p className="rounded-2xl border border-[#365a94] bg-[#0d1f3f] px-3 py-3 text-[11px] text-[#d6e5ff]">
                            {inquiry.message}
                          </p>
                          <button
                            type="button"
                            onClick={async () => {
                              await updateDoc(
                                doc(db, "inquiries", inquiry.id),
                                {
                                  status: "responded",
                                  respondedById: vendorId ?? "",
                                  respondedByName: userDisplayName ?? "Member",
                                  respondedAt: serverTimestamp(),
                                }
                              );
                              setInquiries((current) =>
                                current.map((item) =>
                                  item.id === inquiry.id
                                    ? {
                                        ...item,
                                        status: "responded",
                                        respondedById: vendorId ?? "",
                                        respondedByName:
                                          userDisplayName ?? "Member",
                                        respondedAt: new Date().toLocaleString(),
                                      }
                                    : item
                                )
                              );
                              setSelectedInquiryId(null);
                            }}
                            className="rounded-full bg-[#2454a0] px-3 py-2 text-[11px] font-semibold text-white"
                          >
                            Mark as responded
                          </button>
                        </div>
                      );
                    })()
                  ) : (
                    <p className="text-[#c6d6f7]">
                      Select an inquiry to view details.
                    </p>
                  )}
                </div>
              </div>
            )}

            {activeTab === "leads" && (
              <div className="mt-5 space-y-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSearchVisible((current) => ({
                        ...current,
                        leads: !current.leads,
                      }))
                    }
                    className="rounded-full border border-[#365a94] bg-[#09142b]/70 px-3 py-1 text-[11px] text-[#d6e5ff]"
                  >
                    {searchVisible.leads ? "Hide search" : "Search"}
                  </button>
                  {searchVisible.leads && (
                    <input
                      type="text"
                      value={searchText.leads}
                      onChange={(event) =>
                        setSearchText((current) => ({
                          ...current,
                          leads: event.target.value,
                        }))
                      }
                      placeholder="Search leads..."
                      className="w-full rounded-2xl border border-[#365a94] bg-[#0d1f3f] px-3 py-2 text-xs text-[#e8eefc] sm:w-64"
                    />
                  )}
                </div>
                <div className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-4 py-3 text-xs text-[#c6d6f7]">
                  <p className="text-[10px] uppercase tracking-[0.25em] text-[#d1a741]">
                    SLA automation
                  </p>
                  <p className="mt-2">
                    Response reminder: {Math.round(SLA_RESPONSE_REMINDER_MS / 3600000)}h
                    . Reassign: {Math.round(INQUIRY_REASSIGN_AFTER_MS / 3600000)}h.
                    Lead update reminder: {Math.round(SLA_UPDATE_REMINDER_MS / 3600000)}h.
                    Lead inactivity reassign: {Math.round(SLA_UPDATE_REASSIGN_MS / 3600000)}h.
                    Active window: {BUSINESS_START_HOUR}:00-{BUSINESS_END_HOUR}:00.
                  </p>
                </div>
                {agentScorecards.length > 0 && (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {agentScorecards.map((card) => (
                      <div
                        key={card.agentId}
                        className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-4 py-3 text-xs"
                      >
                        <p className="text-[10px] uppercase tracking-[0.25em] text-[#d1a741]">
                          {card.agentName}
                        </p>
                        <div className="mt-2 space-y-1 text-[#c6d6f7]">
                          <p>Win rate: {card.winRate}%</p>
                          <p>
                            Avg response:{" "}
                            {card.avgResponseMinutes !== null
                              ? `${card.avgResponseMinutes} min`
                              : "N/A"}
                          </p>
                          <p>Revenue closed: Ksh {card.revenueClosed.toLocaleString()}</p>
                          <p>Overdue follow-ups: {card.overdueFollowUps}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-4 py-3 text-xs">
                  <p className="text-[10px] uppercase tracking-[0.25em] text-[#d1a741]">
                    Add manual lead
                  </p>
                  {manualLeadError && (
                    <p className="mt-2 text-[11px] text-[#b3261e]">{manualLeadError}</p>
                  )}
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <input
                      type="text"
                      value={manualLeadName}
                      onChange={(event) => setManualLeadName(event.target.value)}
                      placeholder="Lead name"
                      className="rounded-2xl border border-[#365a94] bg-[#0d1f3f] px-3 py-2 text-sm text-[#e8eefc]"
                    />
                    <input
                      type="text"
                      value={manualLeadPhone}
                      onChange={(event) => setManualLeadPhone(event.target.value)}
                      placeholder="Phone number"
                      className="rounded-2xl border border-[#365a94] bg-[#0d1f3f] px-3 py-2 text-sm text-[#e8eefc]"
                    />
                    <input
                      type="text"
                      value={manualLeadParcel}
                      onChange={(event) => setManualLeadParcel(event.target.value)}
                      placeholder="Parcel or interest"
                      className="rounded-2xl border border-[#365a94] bg-[#0d1f3f] px-3 py-2 text-sm text-[#e8eefc]"
                    />
                    <select
                      value={manualLeadAgentId}
                      onChange={(event) => setManualLeadAgentId(event.target.value)}
                      className="rounded-2xl border border-[#365a94] bg-[#0d1f3f] px-3 py-2 text-sm text-[#e8eefc]"
                    >
                      <option value="">Auto-assign by load</option>
                      {assignableAgents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name || agent.email}
                        </option>
                      ))}
                    </select>
                  </div>
                  <textarea
                    value={manualLeadMessage}
                    onChange={(event) => setManualLeadMessage(event.target.value)}
                    placeholder="Context notes..."
                    className="mt-2 min-h-[72px] w-full rounded-2xl border border-[#365a94] bg-[#0d1f3f] px-3 py-2 text-sm text-[#e8eefc]"
                  />
                  <button
                    type="button"
                    onClick={createManualLead}
                    disabled={manualLeadSaving}
                    className="mt-3 rounded-full bg-[#d1a741] px-4 py-2 text-[11px] font-semibold text-[#091631] disabled:opacity-60"
                  >
                    {manualLeadSaving ? "Saving..." : "Create manual lead"}
                  </button>
                </div>
                {inquiries
                  .filter((lead) =>
                    (lead.status ?? "new") === "responded" ||
                    (lead.status ?? "new") === "successful"
                  )
                  .filter((lead) =>
                    searchText.leads
                      ? `${lead.id} ${lead.buyer} ${lead.parcel} ${lead.phone}`
                          .toLowerCase()
                          .includes(searchText.leads.toLowerCase())
                      : true
                  )
                  .map((lead) => (
                    <div
                      key={lead.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedLeadId(lead.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedLeadId(lead.id);
                        }
                      }}
                      className="flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#284675] bg-[#09142b]/70 px-4 py-3 text-left transition hover:border-[#6f9df0]"
                    >
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-[#d1a741]">
                          {lead.id}
                        </p>
                        <p className="mt-1 font-semibold text-[#f2f6ff]">
                          {lead.buyer}
                        </p>
                        <p className="mt-1 text-xs text-[#c6d6f7]">
                          {lead.parcel}
                        </p>
                        <p className="mt-1 text-[10px] text-[#9eb6e1]">
                          {lead.phone}
                        </p>
                        {isPortalAdmin && lead.assignedAgentName && (
                          <p className="mt-1 text-[10px] text-[#9eb6e1]">
                            Assigned to: {lead.assignedAgentName}
                          </p>
                        )}
                        {isPortalAdmin && (
                          <p className="mt-1 text-[10px] text-[#9eb6e1]">
                            Responded by:{" "}
                            {lead.respondedByName || "Not recorded"}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full border border-[#284675] bg-[#09142b]/70 px-3 py-1 text-[10px] text-[#9eb6e1]">
                          {(lead.status ?? "responded") === "successful"
                            ? "Successful"
                            : "Responded"}
                        </span>
                        <span className="rounded-full border border-[#365a94] px-3 py-1 text-[10px] text-[#c6d6f7]">
                          Open
                        </span>
                      </div>
                      {!isPortalAdmin && (
                        <div className="mt-2 w-full rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-[11px] text-[#c6d6f7]">
                          {leadAiSuggestions[lead.id] ? (
                            <>
                              <p className="text-[10px] uppercase tracking-[0.2em] text-[#d1a741]">
                                AI next step
                              </p>
                              <p className="mt-1 text-[#f2f6ff]">
                                {leadAiSuggestions[lead.id].nextSteps[0] || "Follow up with tailored message."}
                              </p>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                generateLeadAiSuggestions(lead);
                              }}
                              className="rounded-full border border-[#365a94] px-3 py-1 text-[10px]"
                            >
                              {leadAiLoading[lead.id] ? "Generating..." : "AI next step"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            )}

            {activeTab === "visits" && (
              <div className="mt-5 space-y-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSearchVisible((current) => ({
                        ...current,
                        visits: !current.visits,
                      }))
                    }
                    className="rounded-full border border-[#365a94] bg-[#09142b]/70 px-3 py-1 text-[11px] text-[#d6e5ff]"
                  >
                    {searchVisible.visits ? "Hide search" : "Search"}
                  </button>
                  {searchVisible.visits && (
                    <input
                      type="text"
                      value={searchText.visits}
                      onChange={(event) =>
                        setSearchText((current) => ({
                          ...current,
                          visits: event.target.value,
                        }))
                      }
                      placeholder="Search visit requests..."
                      className="w-full rounded-2xl border border-[#365a94] bg-[#0d1f3f] px-3 py-2 text-xs text-[#e8eefc] sm:w-72"
                    />
                  )}
                </div>
                {visitRequests.length === 0 ? (
                  <p className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-4 py-3 text-xs text-[#c6d6f7]">
                    No site visit requests yet.
                  </p>
                ) : (
                  visitRequests
                    .filter((visit) =>
                      searchText.visits
                        ? `${visit.id} ${visit.plotLabel} ${visit.requestedByName} ${visit.requestedByPhone} ${visit.status}`
                            .toLowerCase()
                            .includes(searchText.visits.toLowerCase())
                        : true
                    )
                    .map((visit) => (
                      <div
                        key={visit.id}
                        className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-4 py-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-xs uppercase tracking-[0.3em] text-[#d1a741]">
                              {visit.id}
                            </p>
                            <p className="mt-1 font-semibold text-[#f2f6ff]">
                              {visit.plotLabel}
                            </p>
                            <p className="mt-1 text-xs text-[#c6d6f7]">
                              Requested by: {visit.requestedByName}
                            </p>
                            <p className="mt-1 text-[10px] text-[#9eb6e1]">
                              Phone: {visit.requestedByPhone || "N/A"}
                            </p>
                            <p className="mt-1 text-[10px] text-[#9eb6e1]">
                              Preferred time: {visit.preferredVisitAt || "N/A"}
                            </p>
                            {visit.note ? (
                              <p className="mt-1 text-[10px] text-[#9eb6e1]">
                                Note: {visit.note}
                              </p>
                            ) : null}
                            <p className="mt-1 text-[10px] text-[#9eb6e1]">
                              Requested at: {visit.createdAtLabel}
                            </p>
                            {visit.status === "visited" && (
                              <p className="mt-1 text-[10px] text-[#9eb6e1]">
                                Visited by: {visit.visitedByName || "Member"}
                                {visit.visitedAtLabel ? ` on ${visit.visitedAtLabel}` : ""}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full border border-[#284675] bg-[#09142b]/70 px-3 py-1 text-[10px] text-[#9eb6e1]">
                              {visit.status === "visited" ? "Visited" : "Requested"}
                            </span>
                            {visit.status !== "visited" && (
                              <button
                                type="button"
                                onClick={() => markVisitAsVisited(visit.id)}
                                className="rounded-full bg-[#2454a0] px-3 py-1 text-[10px] font-semibold text-white"
                              >
                                Mark as visited
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                )}
              </div>
            )}

            {activeTab === "members" && (
              <div className="mt-5 space-y-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSearchVisible((current) => ({
                        ...current,
                        members: !current.members,
                      }))
                    }
                    className="rounded-full border border-[#284675] bg-[#09142b]/70 px-3 py-1 text-[11px] text-[#c6d6f7]"
                  >
                    {searchVisible.members ? "Hide search" : "Search"}
                  </button>
                  {searchVisible.members && (
                    <input
                      type="text"
                      value={searchText.members}
                      onChange={(event) =>
                        setSearchText((current) => ({
                          ...current,
                          members: event.target.value,
                        }))
                      }
                      placeholder="Search members..."
                      className="w-full rounded-2xl border border-[#365a94] bg-[#0d1f3f] px-3 py-2 text-xs text-[#e8eefc] sm:w-64"
                    />
                  )}
                </div>

                <div className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-4 py-4">
                  <p className="text-[10px] uppercase tracking-[0.25em] text-[#d1a741]">
                    Add member
                  </p>
                  {memberError && (
                    <p className="mt-2 text-[11px] text-[#b3261e]">
                      {memberError}
                    </p>
                  )}
                  <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
                    <input
                      type="email"
                      value={memberEmail}
                      onChange={(event) => setMemberEmail(event.target.value)}
                      placeholder="Member email"
                      className="w-full rounded-2xl border border-[#365a94] bg-[#0d1f3f] px-3 py-2 text-sm text-[#e8eefc]"
                    />
                    <select
                      value={memberRole}
                      onChange={(event) =>
                        setMemberRole(event.target.value as MemberRole)
                      }
                      className="w-full rounded-2xl border border-[#365a94] bg-[#0d1f3f] px-3 py-2 text-sm text-[#e8eefc]"
                    >
                      <option value="admin">Admin</option>
                      <option value="agent">Agent</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={addMemberByEmail}
                    disabled={memberSaving || !canManageMembers}
                    className="mt-3 rounded-full bg-[#d1a741] px-4 py-2 text-xs font-semibold text-[#091631] disabled:opacity-60"
                  >
                    {memberSaving ? "Adding..." : "Add member"}
                  </button>
                  {!canManageMembers && (
                    <p className="mt-2 text-[10px] text-[#9eb6e1]">
                      Access denied. Contact admin for addition.
                    </p>
                  )}
                </div>

                <div className="space-y-3">
                  {portalMembers
                    .filter((member) =>
                      searchText.members
                        ? `${member.name} ${member.email}`
                            .toLowerCase()
                            .includes(searchText.members.toLowerCase())
                      : true
                    )
                    .map((member) => (
                      <div
                        key={member.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#284675] bg-[#09142b]/70 px-4 py-3 text-xs"
                      >
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.3em] text-[#d1a741]">
                            {member.role}
                          </p>
                          <p className="mt-1 text-sm font-semibold text-[#f2f6ff]">
                            {member.name}
                          </p>
                          <p className="mt-1 text-[11px] text-[#c6d6f7]">
                            {member.email || "Email not set"}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {editingMemberId === member.id ? (
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2 text-[10px] text-[#c6d6f7]">
                                <label className="flex items-center gap-2">
                                  <span>Role</span>
                                  <select
                                    value={editingRole}
                                    onChange={(event) =>
                                      setEditingRole(
                                        event.target.value as MemberRole
                                      )
                                    }
                                    className="rounded-full border border-[#284675] bg-[#09142b]/70 px-2 py-1 text-[10px] text-[#c6d6f7]"
                                  >
                                    <option value="admin">Admin</option>
                                    <option value="agent">Agent</option>
                                  </select>
                                </label>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={saveMemberPermissions}
                                  disabled={memberUpdating}
                                  className="rounded-full bg-[#2454a0] px-3 py-1 text-[10px] font-semibold text-white disabled:opacity-60"
                                >
                                  {memberUpdating ? "Saving..." : "Save"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingMemberId(null)}
                                  className="rounded-full border border-[#365a94] px-3 py-1 text-[10px] text-[#c6d6f7]"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex flex-wrap gap-2 text-[10px] text-[#c6d6f7]">
                                {member.role === "admin" ? (
                                  <span className="rounded-full border border-[#284675] bg-[#09142b]/70 px-2 py-1">
                                    Full access
                                  </span>
                                ) : (
                                  <>
                                    {member.permissions.create_listings && (
                                      <span className="rounded-full border border-[#284675] bg-[#09142b]/70 px-2 py-1">
                                        Listings
                                      </span>
                                    )}
                                    {member.permissions.add_sales && (
                                      <span className="rounded-full border border-[#284675] bg-[#09142b]/70 px-2 py-1">
                                        Sales
                                      </span>
                                    )}
                                    {member.permissions.view_inquiries && (
                                      <span className="rounded-full border border-[#284675] bg-[#09142b]/70 px-2 py-1">
                                        Inquiries
                                      </span>
                                    )}
                                    {member.permissions.view_leads && (
                                      <span className="rounded-full border border-[#284675] bg-[#09142b]/70 px-2 py-1">
                                        Leads
                                      </span>
                                    )}
                                    {member.permissions.manage_members && (
                                      <span className="rounded-full border border-[#284675] bg-[#09142b]/70 px-2 py-1">
                                        Members
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>
                              {canManageMembers && member.id !== vendorId && (
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => startEditMember(member)}
                                    className="rounded-full border border-[#365a94] px-3 py-1 text-[10px] text-[#c6d6f7] hover:border-[#c9b8a6]"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeMember(member.id)}
                                    className="rounded-full border border-[#365a94] px-3 py-1 text-[10px] text-[#9eb6e1] hover:border-[#c9b8a6]"
                                  >
                                    Remove
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {activeTab === "pending" && (
              <div className="mt-5 space-y-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSearchVisible((current) => ({
                        ...current,
                        pending: !current.pending,
                      }))
                    }
                    className="rounded-full border border-[#284675] bg-[#09142b]/70 px-3 py-1 text-[11px] text-[#c6d6f7]"
                  >
                    {searchVisible.pending ? "Hide search" : "Search"}
                  </button>
                  {searchVisible.pending && (
                    <input
                      type="text"
                      value={searchText.pending}
                      onChange={(event) =>
                        setSearchText((current) => ({
                          ...current,
                          pending: event.target.value,
                        }))
                      }
                      placeholder="Search pending sales..."
                      className="w-full rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-xs text-[#f2f6ff] sm:w-64"
                    />
                  )}
                </div>
                {visiblePendingSales
                  .filter((sale) =>
                    searchText.pending
                      ? `${sale.id} ${sale.parcelName} ${sale.buyer}`
                          .toLowerCase()
                          .includes(searchText.pending.toLowerCase())
                      : true
                  )
                  .map((sale) => (
                  <div
                    key={sale.id}
                    className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-[#d1a741]">
                          {sale.id}
                        </p>
                        <p className="mt-1 font-semibold text-[#f2f6ff]">
                          {sale.parcelName}
                        </p>
                        <p className="mt-1 text-xs text-[#c6d6f7]">
                          Buyer: {sale.buyer}
                        </p>
                        {isPortalAdmin && (
                          <p className="mt-1 text-[10px] text-[#9eb6e1]">
                            Sold by: {sale.createdByAgentName || "Unknown"}
                          </p>
                        )}
                      </div>
                      <div className="text-right text-xs">
                        <p className="text-[#1f3d2d]">
                          Ksh {sale.salePrice.toLocaleString()}
                        </p>
                        <p className="text-[#9eb6e1]">{sale.soldOn}</p>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 text-[11px] text-[#c6d6f7] sm:grid-cols-3">
                      <span>Net: Ksh {sale.netToVendor.toLocaleString()}</span>
                      <span>Paid: Ksh {sale.totalPaid.toLocaleString()}</span>
                      <span>
                        Remaining: Ksh {sale.remainingBalance.toLocaleString()}
                      </span>
                    </div>
                    {(sale.fullyPaid || sale.remainingBalance <= 0) && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-[11px] text-[#1f3d2d]">
                        <span>
                          Payments fully received. Close the sale to finalize.
                        </span>
                        <button
                          type="button"
                          onClick={() => closePendingSale(sale)}
                          className="rounded-full bg-[#2454a0] px-3 py-1 text-[10px] font-semibold text-white"
                          disabled={!canAddSales}
                        >
                          Close sale
                        </button>
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <span className="text-[#9eb6e1]">
                        Remaining balance: Ksh{" "}
                        {sale.remainingBalance.toLocaleString()}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedPendingId((current) =>
                            current === sale.id ? null : sale.id
                          )
                        }
                        className="rounded-full border border-[#365a94] bg-[#09142b]/70 px-3 py-1 text-[#1f3d2d]"
                      >
                        {expandedPendingId === sale.id
                          ? "Hide installments"
                          : "Update installments"}
                      </button>
                    </div>
                    <div className="mt-3 rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-3 text-[11px] text-[#c6d6f7]">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] uppercase tracking-[0.25em] text-[#d1a741]">
                          Installments recorded
                        </p>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full border border-[#365a94] px-2 py-1 text-[9px] text-[#c6d6f7]">
                            {sale.installments.length}
                          </span>
                          {installmentsOpenId === sale.id ? (
                            <button
                              type="button"
                              onClick={() => setInstallmentsOpenId(null)}
                              className="rounded-full border border-[#365a94] px-2 py-1 text-[9px] text-[#c6d6f7]"
                            >
                              Close
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setInstallmentsOpenId(sale.id)}
                              className="rounded-full border border-[#365a94] px-2 py-1 text-[9px] text-[#c6d6f7]"
                            >
                              View
                            </button>
                          )}
                        </div>
                      </div>
                      {installmentsOpenId === sale.id && (
                        <div className="mt-3 overflow-x-auto">
                        <table className="w-full text-left text-[11px]">
                          <thead className="text-[10px] uppercase tracking-[0.2em] text-[#d1a741]">
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
                                  {parseKshInput(installment.amount).toLocaleString()}
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
                                      className="inline-flex rounded-full border border-[#365a94] px-2 py-1 text-[10px] text-[#1f3d2d]"
                                      title={installment.proofName || "View proof"}
                                    >
                                      View
                                    </a>
                                  ) : (
                                    <span className="text-[#9eb6e1]">—</span>
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
                      <div className="mt-3 rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-3 text-[11px] text-[#c6d6f7]">
                        <p className="text-[10px] uppercase tracking-[0.25em] text-[#d1a741]">
                          Add / update installments
                        </p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_140px]">
                          <input
                            type="text"
                            value={installmentDrafts[sale.id]?.amount ?? ""}
                            onChange={(event) =>
                              setInstallmentDrafts((current) => ({
                                ...current,
                                [sale.id]: {
                                  amount: formatKshInput(event.target.value),
                                  date: current[sale.id]?.date ?? "",
                                  method:
                                    current[sale.id]?.method ?? "Mobile money",
                                  proofFile: current[sale.id]?.proofFile ?? null,
                                },
                              }))
                            }
                            placeholder="Ksh 0"
                            className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-sm text-[#f2f6ff]"
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
                            className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-sm text-[#f2f6ff]"
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
                            className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-sm text-[#f2f6ff]"
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
                            className="text-xs text-[#c6d6f7] file:mr-3 file:rounded-full file:border-0 file:bg-[#c77d4b] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
                          />
                          {installmentDrafts[sale.id]?.proofFile ? (
                            <span className="rounded-full border border-[#365a94] px-3 py-1 text-[10px] text-[#d6e5ff]">
                              {installmentDrafts[sale.id]?.proofFile?.name}
                            </span>
                          ) : (
                            <span className="text-[10px] text-[#9eb6e1]">
                              Optional payment proof
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => submitPendingInstallment(sale.id)}
                          className="mt-3 rounded-full bg-[#2454a0] px-3 py-2 text-[11px] font-semibold text-white"
                          disabled={installmentDrafts[sale.id]?.saving || !canAddSales}
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSearchVisible((current) => ({
                        ...current,
                        sales: !current.sales,
                      }))
                    }
                    className="rounded-full border border-[#284675] bg-[#09142b]/70 px-3 py-1 text-[11px] text-[#c6d6f7]"
                  >
                    {searchVisible.sales ? "Hide search" : "Search"}
                  </button>
                  {searchVisible.sales && (
                    <input
                      type="text"
                      value={searchText.sales}
                      onChange={(event) =>
                        setSearchText((current) => ({
                          ...current,
                          sales: event.target.value,
                        }))
                      }
                      placeholder="Search sales..."
                      className="w-full rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-xs text-[#f2f6ff] sm:w-64"
                    />
                  )}
                </div>
                {visibleSales
                  .filter((sale) =>
                    searchText.sales
                      ? `${sale.id} ${sale.parcelName} ${sale.buyer}`
                          .toLowerCase()
                          .includes(searchText.sales.toLowerCase())
                      : true
                  )
                  .map((sale) => (
                  <div
                    key={sale.id}
                    className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-[#d1a741]">
                          {sale.id}
                        </p>
                        <p className="mt-1 font-semibold text-[#f2f6ff]">
                          {sale.parcelName}
                        </p>
                        <p className="mt-1 text-xs text-[#c6d6f7]">
                          Buyer: {sale.buyer}
                        </p>
                        {isPortalAdmin && (
                          <p className="mt-1 text-[10px] text-[#9eb6e1]">
                            Sold by: {sale.createdByAgentName || "Unknown"}
                          </p>
                        )}
                      </div>
                      <div className="text-right text-xs">
                        <p className="text-[#1f3d2d]">
                          Ksh {sale.salePrice.toLocaleString()}
                        </p>
                        <p className="text-[#9eb6e1]">{sale.soldOn}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between text-[11px] text-[#c6d6f7]">
                      <span>Fee: Ksh {sale.processingFee.toLocaleString()}</span>
                      <span>Net: Ksh {sale.netToVendor.toLocaleString()}</span>
                    </div>
                    <div className="mt-3 rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-3 text-[11px] text-[#c6d6f7]">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.25em] text-[#d1a741]">
                            Documents
                          </p>
                          <p className="mt-1 text-[10px] text-[#9eb6e1]">
                            View all uploaded sale documents.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setDocumentsOpenId((current) =>
                              current === sale.id ? null : sale.id
                            )
                          }
                          className="rounded-full border border-[#365a94] px-3 py-1 text-[10px] text-[#c6d6f7]"
                        >
                          {documentsOpenId === sale.id ? "Hide" : "View"}
                        </button>
                      </div>
                      {documentsOpenId === sale.id && (
                        <div className="mt-3 space-y-2">
                          {sale.attachments && sale.attachments.length > 0 ? (
                            sale.attachments.map((doc, idx) => (
                              <div
                                key={`${sale.id}-doc-${idx}`}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#365a94] px-3 py-2 text-[10px]"
                              >
                                <div>
                                  <p className="font-semibold text-[#f2f6ff]">
                                    {doc.label || "Document"}
                                  </p>
                                  <p className="text-[#9eb6e1]">{doc.name}</p>
                                </div>
                                {doc.url ? (
                                  <a
                                    href={doc.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-full border border-[#365a94] px-3 py-1 text-[10px] text-[#1f3d2d]"
                                  >
                                    View
                                  </a>
                                ) : (
                                  <span className="text-[#9eb6e1]">—</span>
                                )}
                              </div>
                            ))
                          ) : (
                            <p className="text-[10px] text-[#9eb6e1]">
                              No documents uploaded for this sale.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

          </div>

        </section>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[#284675] bg-[#08152f]/92 px-4 py-3 text-xs backdrop-blur lg:hidden">
        <div className="relative">
          <div className="overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex min-w-max items-center gap-2 pr-14">
              {[
                { id: "active", label: "Active" },
                { id: "drafts", label: "Drafts" },
                { id: "inquiries", label: "Inquiries" },
                { id: "leads", label: "Leads" },
                { id: "visits", label: "Visits" },
                { id: "pending", label: "Pending" },
                { id: "sales", label: "Sales" },
                { id: "members", label: "Members" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() =>
                    handleTabChange(
                      tab.id as
                        | "active"
                        | "drafts"
                        | "inquiries"
                        | "leads"
                        | "visits"
                        | "pending"
                        | "sales"
                        | "members"
                    )
                  }
                  className={`shrink-0 rounded-full px-3 py-2 text-xs transition ${
                    activeTab === tab.id
                      ? "bg-[#2454a0] text-white"
                      : "border border-[#365a94] bg-[#09142b]/70 text-[#d6e5ff]"
                  } ${canAccessTab(tab.id) ? "" : "opacity-60"}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 rounded-full border border-[#365a94] bg-[#09142b]/95 px-2 py-1 text-[10px] text-[#9eb6e1] shadow-sm animate-pulse">
            Scroll &gt;
          </div>
        </div>
      </nav>

      {saleModalOpen && saleDraft && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl border border-[#284675] bg-[#0a1834]/95 p-6 shadow-[0_30px_70px_-40px_rgba(0,0,0,0.9)]">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-[#d1a741]">
                  Record sale
                </p>
                <p className="mt-2 font-serif text-xl text-[#f2f6ff]">
                  {saleDraft.parcelName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSaleModalOpen(false)}
                className="rounded-full border border-[#365a94] px-3 py-1 text-xs text-[#c6d6f7]"
              >
                Close
              </button>
            </div>

            <div className="mt-5 space-y-4 text-xs">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="text-[10px] uppercase tracking-[0.25em] text-[#d1a741]">
                    Buyer name
                  </label>
                  <input
                    type="text"
                    value={buyerNameInput}
                    onChange={(event) => setBuyerNameInput(event.target.value)}
                    placeholder="Buyer or company name"
                    className="mt-2 w-full rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-sm text-[#f2f6ff]"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.25em] text-[#d1a741]">
                    Selling price
                  </label>
                  <input
                    type="text"
                    value={salePriceInput}
                    onChange={(event) =>
                      setSalePriceInput(formatKshInput(event.target.value))
                    }
                    placeholder="e.g. Ksh 48,000"
                    className="mt-2 w-full rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-sm text-[#f2f6ff]"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-[#d1a741]">
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
                          ? "bg-[#2454a0] text-white"
                          : "border border-[#284675] bg-[#09142b]/70 text-[#c6d6f7]"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-[#d1a741]">
                  Charges & expenses
                </label>
                {charges.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {charges.map((charge) => (
                      <div
                        key={charge.id}
                        className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_130px_140px_auto]"
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
                          className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-sm text-[#f2f6ff]"
                        />
                        <input
                          type="text"
                          value={charge.amount}
                          onChange={(event) =>
                            setCharges((current) =>
                              current.map((item) =>
                                item.id === charge.id
                                  ? {
                                      ...item,
                                      amount: formatKshInput(event.target.value),
                                    }
                                  : item
                              )
                            )
                          }
                          placeholder="Ksh 0"
                          className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-sm text-[#f2f6ff]"
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
                          className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-sm text-[#f2f6ff]"
                        >
                          <option value="charge">Charge</option>
                          <option value="expense">Expense</option>
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            setCharges((current) =>
                              current.filter((item) => item.id !== charge.id)
                            )
                          }
                          className="rounded-full border border-[#365a94] px-3 py-2 text-xs text-[#c6d6f7]"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setCharges((current) => [
                      ...current,
                      { id: Date.now(), label: "", amount: "", kind: "charge" },
                    ])
                  }
                  className="mt-3 rounded-full border border-[#365a94] px-3 py-2 text-xs text-[#c6d6f7]"
                >
                  Add item
                </button>
              </div>
              <div className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.25em] text-[#d1a741]">
                  Attachment
                </p>
                <div className="mt-3 space-y-2">
                  {saleAttachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px_auto]"
                    >
                      <input
                        type="text"
                        value={attachment.label}
                        onChange={(event) =>
                          setSaleAttachments((current) =>
                            current.map((item) =>
                              item.id === attachment.id
                                ? { ...item, label: event.target.value }
                                : item
                            )
                          )
                        }
                        placeholder="File label (e.g. Contract)"
                        className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-sm text-[#f2f6ff]"
                      />
                      <input
                        type="file"
                        accept="application/pdf,image/*"
                        onChange={(event) => {
                          const file = event.target.files?.[0] ?? null;
                          setSaleAttachments((current) =>
                            current.map((item) =>
                              item.id === attachment.id
                                ? {
                                    ...item,
                                    file,
                                    name: file ? file.name : "",
                                  }
                                : item
                            )
                          );
                        }}
                        className="text-xs text-[#c6d6f7] file:mr-3 file:rounded-full file:border-0 file:bg-[#c77d4b] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setSaleAttachments((current) =>
                            current.filter((item) => item.id !== attachment.id)
                          )
                        }
                        className="rounded-full border border-[#365a94] px-3 py-2 text-xs text-[#c6d6f7]"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                {saleAttachments.length === 0 ? (
                  <p className="mt-2 text-[10px] text-[#9eb6e1]">
                    Optional files for this sale record.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {saleAttachments
                      .filter((item) => item.name)
                      .map((item) => (
                        <span
                          key={item.id}
                          className="inline-flex rounded-full border border-[#365a94] px-3 py-1 text-[10px] text-[#d6e5ff]"
                        >
                          {item.name}
                        </span>
                      ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setSaleAttachments((current) => [
                      ...current,
                      { id: Date.now(), label: "", file: null, name: "" },
                    ])
                  }
                  className="mt-3 rounded-full border border-[#365a94] px-3 py-2 text-xs text-[#c6d6f7]"
                >
                  Add attachment
                </button>
              </div>
              {saleType === "installments" && (
                <div>
                  <label className="text-[10px] uppercase tracking-[0.25em] text-[#d1a741]">
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
                            type="text"
                            value={installment.amount}
                            onChange={(event) =>
                              setInstallments((current) =>
                                current.map((item) =>
                                  item.id === installment.id
                                    ? {
                                        ...item,
                                        amount: formatKshInput(event.target.value),
                                      }
                                    : item
                                )
                              )
                            }
                            placeholder="Ksh 0"
                            className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-sm text-[#f2f6ff]"
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
                            className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-sm text-[#f2f6ff]"
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
                            className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-sm text-[#f2f6ff]"
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
                            className="rounded-full border border-[#365a94] px-3 py-2 text-xs text-[#c6d6f7]"
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
                                            proofFile: file ?? null,
                                          }
                                        : item
                                    )
                                  );
                                }}
                                className="text-xs text-[#c6d6f7] file:mr-3 file:rounded-full file:border-0 file:bg-[#c77d4b] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
                              />
                              {installment.proofName ? (
                                <span className="rounded-full border border-[#365a94] px-3 py-1 text-[10px] text-[#d6e5ff]">
                                  {installment.proofName}
                                </span>
                              ) : (
                                <span className="text-[10px] text-[#9eb6e1]">
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
                    className="mt-3 rounded-full border border-[#365a94] px-3 py-2 text-xs text-[#c6d6f7]"
                  >
                    Add installment
                  </button>
                  <div className="mt-3">
                    <label className="text-[10px] uppercase tracking-[0.25em] text-[#d1a741]">
                      Next payment date
                    </label>
                    <input
                      type="date"
                      value={nextPaymentDate}
                      onChange={(event) => setNextPaymentDate(event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-sm text-[#f2f6ff]"
                    />
                  </div>
                </div>
              )}
              <div className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-4 py-3 text-[11px] text-[#c6d6f7]">
                <p>
                  Net to vendor: Ksh{" "}
                  {Math.max(
                    parseKshInput(salePriceInput) -
                      charges.reduce((sum, charge) => {
                        const fee = parseKshInput(charge.amount);
                        return sum + fee;
                      }, 0),
                    0
                  ).toLocaleString()}
                </p>
                <p className="mt-1">
                  Total paid: Ksh{" "}
                  {(saleType === "cash"
                    ? Math.max(
                        parseKshInput(salePriceInput) -
                          charges.reduce((sum, charge) => {
                            const fee = parseKshInput(charge.amount);
                            return sum + fee;
                          }, 0),
                        0
                      )
                    : installments.reduce((sum, installment) => {
                        const paid = parseKshInput(installment.amount);
                        return sum + paid;
                      }, 0)
                  ).toLocaleString()}
                </p>
                <p className="mt-1">
                  Remaining balance: Ksh{" "}
                  {Math.max(
                    Math.max(
                      parseKshInput(salePriceInput) -
                        charges.reduce((sum, charge) => {
                          const fee = parseKshInput(charge.amount);
                          return sum + fee;
                        }, 0),
                      0
                    ) -
                      (saleType === "cash"
                        ? Math.max(
                            parseKshInput(salePriceInput) -
                              charges.reduce((sum, charge) => {
                                const fee = parseKshInput(charge.amount);
                                return sum + fee;
                              }, 0),
                            0
                          )
                        : installments.reduce((sum, installment) => {
                            const paid = parseKshInput(installment.amount);
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
                className="rounded-full border border-[#365a94] px-4 py-2 text-xs text-[#c6d6f7]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmSale}
                className="rounded-full bg-[#2454a0] px-4 py-2 text-xs font-semibold text-white"
              >
                Record sale
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedLeadId && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl border border-[#284675] bg-[#09142b]/70 p-6 shadow-[0_30px_70px_-40px_rgba(20,17,15,0.6)]">
            {(() => {
              const lead = inquiries.find((item) => item.id === selectedLeadId);
              if (!lead) {
                return (
                  <div className="space-y-3 text-sm text-[#c6d6f7]">
                    <p>Lead not found.</p>
                    <button
                      type="button"
                      onClick={() => setSelectedLeadId(null)}
                      className="rounded-full border border-[#365a94] px-3 py-1 text-xs"
                    >
                      Close
                    </button>
                  </div>
                );
              }
              return (
                <>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.35em] text-[#d1a741]">
                        Lead progress
                      </p>
                      <p className="mt-2 font-serif text-xl text-[#f2f6ff]">
                        {lead.buyer} - {lead.parcel}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedLeadId(null)}
                      className="rounded-full border border-[#365a94] px-3 py-1 text-xs text-[#c6d6f7]"
                    >
                      Close
                    </button>
                  </div>

                  <div className="mt-4 space-y-2 text-xs text-[#c6d6f7]">
                    <p>Phone: {lead.phone}</p>
                    <p>Assigned to: {lead.assignedAgentName || "Unassigned"}</p>
                    <p>
                      Responded by: {lead.respondedByName || "Not recorded"}
                      {lead.respondedAt ? ` (${lead.respondedAt})` : ""}
                    </p>
                    {lead.nextFollowUpAt && (
                      <p>Next follow-up: {new Date(lead.nextFollowUpAt).toLocaleString()}</p>
                    )}
                  </div>

                  <div className="mt-4 rounded-2xl border border-[#284675] bg-[#09142b]/70 px-4 py-3">
                    <div className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-[#d1a741]">
                          AI suggestions
                        </p>
                        <button
                          type="button"
                          onClick={() => generateLeadAiSuggestions(lead)}
                          className="rounded-full border border-[#365a94] px-3 py-1 text-[10px]"
                        >
                          {leadAiLoading[lead.id] ? "Generating..." : "Refresh"}
                        </button>
                      </div>
                      {leadAiSuggestions[lead.id] ? (
                        <div className="mt-2 space-y-2 text-[#c6d6f7]">
                          <p>
                            Next step:{" "}
                            <span className="text-[#f2f6ff]">
                              {leadAiSuggestions[lead.id].nextSteps[0] || "Follow up with personalized update."}
                            </span>
                          </p>
                          {leadAiSuggestions[lead.id].messageSuggestions.length > 0 && (
                            <div>
                              <p className="text-[10px] uppercase tracking-[0.2em] text-[#d1a741]">
                                Suggested texts
                              </p>
                              <div className="mt-1 space-y-1">
                                {leadAiSuggestions[lead.id].messageSuggestions
                                  .slice(0, 2)
                                  .map((text, index) => (
                                    <p key={`${lead.id}-msg-${index}`} className="rounded-xl border border-[#284675] bg-[#09142b]/70 px-2 py-1">
                                      {text}
                                    </p>
                                  ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="mt-2 text-[#9eb6e1]">
                          Generate lead-specific next steps and text suggestions.
                        </p>
                      )}
                    </div>
                    <p className="text-[10px] uppercase tracking-[0.25em] text-[#d1a741]">
                      Conversation progress
                    </p>
                    <div className="mt-3 space-y-2">
                      {(lead.progressLogs ?? []).length > 0 ? (
                        (lead.progressLogs ?? []).map((entry) => (
                          <div
                            key={entry.id}
                            className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-[11px]"
                          >
                            <p className="text-[#f2f6ff]">{entry.note}</p>
                            <p className="mt-1 text-[10px] text-[#9eb6e1]">
                              {entry.byName} - {entry.at}
                              {entry.kind ? ` - ${entry.kind.replace("_", " ")}` : ""}
                              {entry.channel ? ` - ${entry.channel}` : ""}
                              {entry.nextFollowUpAt
                                ? ` - next: ${new Date(entry.nextFollowUpAt).toLocaleString()}`
                                : ""}
                            </p>
                          </div>
                        ))
                      ) : (
                        <p className="text-[11px] text-[#9eb6e1]">
                          No progress updates yet.
                        </p>
                      )}
                    </div>
                    <textarea
                      value={leadProgressNote}
                      onChange={(event) => setLeadProgressNote(event.target.value)}
                      placeholder="Example: Visited site with customer; requested payment plan."
                      className="mt-3 min-h-[90px] w-full rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-sm text-[#f2f6ff]"
                    />
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <select
                        value={leadProgressKind}
                        onChange={(event) =>
                          setLeadProgressKind(
                            event.target.value as
                              | "call"
                              | "site_visit"
                              | "offer"
                              | "objection"
                              | "follow_up"
                          )
                        }
                        className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-sm text-[#f2f6ff]"
                      >
                        <option value="follow_up">Follow-up</option>
                        <option value="call">Call</option>
                        <option value="site_visit">Site visit</option>
                        <option value="offer">Offer</option>
                        <option value="objection">Objection</option>
                      </select>
                      <select
                        value={leadReminderChannel}
                        onChange={(event) =>
                          setLeadReminderChannel(
                            event.target.value as "Call" | "WhatsApp" | "SMS" | "Email"
                          )
                        }
                        className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-sm text-[#f2f6ff]"
                      >
                        <option value="WhatsApp">WhatsApp</option>
                        <option value="SMS">SMS</option>
                        <option value="Email">Email</option>
                        <option value="Call">Call</option>
                      </select>
                      <input
                        type="datetime-local"
                        value={leadNextFollowUpAt}
                        onChange={(event) => setLeadNextFollowUpAt(event.target.value)}
                        className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-sm text-[#f2f6ff]"
                      />
                      <input
                        type="datetime-local"
                        value={leadReminderAt}
                        onChange={(event) => setLeadReminderAt(event.target.value)}
                        className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-sm text-[#f2f6ff]"
                      />
                    </div>
                    {(lead.reminders ?? []).length > 0 && (
                      <div className="mt-3 rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-[11px]">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-[#d1a741]">
                          Scheduled reminders
                        </p>
                        <div className="mt-2 space-y-1 text-[#c6d6f7]">
                          {(lead.reminders ?? []).map((reminder) => (
                            <p key={reminder.id}>
                              {reminder.channel} - {new Date(reminder.scheduledAt).toLocaleString()} -{" "}
                              {reminder.status === "sent" ? "sent" : "scheduled"}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={logLeadProgress}
                        disabled={leadProgressSaving}
                        className="rounded-full bg-[#2454a0] px-4 py-2 text-[11px] font-semibold text-white disabled:opacity-60"
                      >
                        {leadProgressSaving ? "Saving..." : "Save progress"}
                      </button>
                      <button
                        type="button"
                        onClick={markLeadSuccessful}
                        disabled={
                          leadStatusSaving ||
                          (lead.status ?? "responded") === "successful"
                        }
                        className="rounded-full border border-[#1f3d2d] bg-[#0d1f3f] px-4 py-2 text-[11px] font-semibold text-[#1f3d2d] disabled:opacity-60"
                      >
                        {leadStatusSaving
                          ? "Updating..."
                          : (lead.status ?? "responded") === "successful"
                          ? "Marked successful"
                          : "Mark lead successful"}
                      </button>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {newListingOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border border-[#284675] bg-[#09142b]/70 p-6 shadow-[0_30px_70px_-40px_rgba(20,17,15,0.6)]">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-[#d1a741]">
                  New listing
                </p>
                <p className="mt-2 font-serif text-2xl text-[#f2f6ff]">
                  Capture a parcel
                </p>
                <p className="mt-2 text-xs text-[#c6d6f7]">
                  Step {listingStep} of 3
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNewListingOpen(false)}
                className="rounded-full border border-[#365a94] px-3 py-1 text-xs text-[#c6d6f7]"
              >
                Close
              </button>
            </div>

            {listingStep === 1 && (
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-[10px] uppercase tracking-[0.25em] text-[#d1a741]">
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
                    className="mt-2 w-full rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-sm text-[#f2f6ff]"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.25em] text-[#d1a741]">
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
                    className="mt-2 w-full rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-sm text-[#f2f6ff]"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.25em] text-[#d1a741]">
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
                    className="mt-2 w-full rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-sm text-[#f2f6ff]"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.25em] text-[#d1a741]">
                    Number of parcels
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={listingParcelCount}
                    onChange={(event) => {
                      setListingParcelCount(event.target.value);
                      setListingStepError(null);
                    }}
                    placeholder="e.g. 4"
                    className="mt-2 w-full rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-sm text-[#f2f6ff]"
                  />
                </div>
                {listingStepError && (
                  <div className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-[11px] text-[#b3261e] md:col-span-2">
                    {listingStepError}
                  </div>
                )}
                <div className="md:col-span-2">
                  <label className="text-[10px] uppercase tracking-[0.25em] text-[#d1a741]">
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
                              : 'border border-[#284675] bg-[#09142b]/70 text-[#d6e5ff]'
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
                <div className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-4 py-4">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-[#d1a741]">
                    Mutation form
                  </p>
                  <p className="mt-2 text-xs text-[#c6d6f7]">
                    Upload an image or PDF of the mutation form. PDFs are
                    uploaded as-is, while images are enhanced before upload.
                  </p>
                  <input
                    type="file"
                    accept=".pdf,image/*"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      const activeVendorId = getActiveVendorId();
                      if (!activeVendorId) {
                        setListingStepError("Vendor account is not ready yet.");
                        return;
                      }
                      setMutationFormUploading(true);
                      setListingStepError(null);
                      try {
                        const isPdf =
                          file.type === "application/pdf" ||
                          file.name.toLowerCase().endsWith(".pdf");
                        const processedFile = isPdf
                          ? file
                          : await enhanceMutationImage(file);
                        const fileRef = ref(
                          storage,
                          `vendors/${activeVendorId}/mutation-forms/${Date.now()}-${processedFile.name}`
                        );
                        await uploadBytes(fileRef, processedFile);
                        const url = await getDownloadURL(fileRef);
                        setMutationFormName(
                          isPdf ? file.name : processedFile.name
                        );
                        setMutationFormUrl(url);
                        if (isPdf) {
                          setMutationParcels([]);
                        } else {
                          try {
                            const parseResponse = await fetch(
                              "/api/mutation-parcels",
                              {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  mutationFormUrl: url,
                                  expectedParcelCount: Math.max(
                                    1,
                                    Number.parseInt(listingParcelCount, 10) || 1
                                  ),
                                }),
                              }
                            );
                            const parsePayload = (await parseResponse.json()) as {
                              parcels?: MutationParcel[];
                              error?: string;
                            };
                            if (!parseResponse.ok) {
                              throw new Error(
                                parsePayload.error ||
                                  "Could not extract parcel polygons."
                              );
                            }
                            const parsedParcels = parsePayload.parcels ?? [];
                            setMutationParcels(parsedParcels);
                            if (parsedParcels.length > 0) {
                              setListingParcelCount(String(parsedParcels.length));
                            }
                          } catch (error) {
                            setMutationParcels([]);
                            const details =
                              error instanceof Error
                                ? error.message
                                : "Unknown parse error.";
                            setListingStepError(
                              `Mutation form uploaded, but parcel polygons were not extracted. ${details}`
                            );
                          }
                        }
                      } catch (error) {
                        const details =
                          error instanceof Error ? error.message : "Unknown error.";
                        setListingStepError(
                          `Could not upload mutation form (raw PDF mode). ${details}`
                        );
                      } finally {
                        setMutationFormUploading(false);
                      }
                    }}
                    className="mt-3 w-full text-xs text-[#c6d6f7] file:mr-3 file:rounded-full file:border-0 file:bg-[#c77d4b] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
                  />
                  {mutationFormUrl && (
                    <p className="mt-2 text-[11px] text-[#d6e5ff]">
                      Uploaded: {mutationFormName || "Mutation form"}.
                    </p>
                  )}
                  {mutationParcels.length > 0 && (
                    <p className="mt-1 text-[11px] text-[#1f3d2d]">
                      Extracted {mutationParcels.length} parcel polygons.
                    </p>
                  )}
                  {mutationFormUploading && (
                    <p className="mt-2 text-[11px] text-[#d6e5ff]">
                      Uploading mutation form...
                    </p>
                  )}
                </div>

                <div className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-4 py-4">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-[#d1a741]">
                    Plot location
                  </p>
                  <p className="mt-2 text-xs text-[#c6d6f7]">
                    Pick the exact plot location on the satellite map.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setAnchorMapOpen(true)}
                      className="rounded-full bg-[#2454a0] px-4 py-2 text-xs font-semibold text-white"
                    >
                      Open satellite map
                    </button>
                    <span className="text-[11px] text-[#c6d6f7]">
                      {anchorTrueCoord
                        ? `${anchorTrueCoord.lat.toFixed(6)}, ${anchorTrueCoord.lng.toFixed(6)}`
                        : "No location selected yet."}
                    </span>
                  </div>
                </div>

                {listingStepError && (
                  <div className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-[11px] text-[#b3261e]">
                    {listingStepError}
                  </div>
                )}
              </div>
            )}
            {listingStep === 3 && (
              <div className="mt-6 space-y-4 text-xs text-[#3a2f2a]">
                <div className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-4 py-4">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-[#d1a741]">
                    Surrounding images
                  </p>
                  <p className="mt-2 text-xs text-[#c6d6f7]">
                    Upload images showing the surroundings of the plot.
                  </p>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={async (event) => {
                      const files = Array.from(event.target.files ?? []);
                      if (!files.length) return;
                      const activeVendorId = getActiveVendorId();
                      if (!activeVendorId) {
                        setListingStepError("Vendor account is not ready yet.");
                        return;
                      }
                      setSurroundingUploading(true);
                      setListingStepError(null);
                      try {
                        const uploaded = await Promise.all(
                          files.map(async (file, idx) => {
                            const fileRef = ref(
                              storage,
                              `vendors/${activeVendorId}/surrounding/${Date.now()}-${idx}-${file.name}`
                            );
                            await uploadBytes(fileRef, file);
                            const url = await getDownloadURL(fileRef);
                            return {
                              id: Date.now() + idx,
                              name: file.name,
                              url,
                            };
                          })
                        );
                        setSurroundingImages((current) => [...current, ...uploaded]);
                      } catch {
                        setListingStepError(
                          "Could not upload one or more images. Try again."
                        );
                      } finally {
                        setSurroundingUploading(false);
                      }
                    }}
                    className="mt-3 w-full text-xs text-[#c6d6f7] file:mr-3 file:rounded-full file:border-0 file:bg-[#c77d4b] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
                  />
                  {surroundingUploading && (
                    <p className="mt-2 text-[11px] text-[#d6e5ff]">
                      Uploading surrounding images...
                    </p>
                  )}
                  {surroundingImages.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {surroundingImages.map((image) => (
                        <div
                          key={image.id}
                          className="flex items-center justify-between rounded-xl border border-[#365a94] px-3 py-2"
                        >
                          <span className="text-[11px] text-[#c6d6f7]">
                            {image.name}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setSurroundingImages((current) =>
                                current.filter((item) => item.id !== image.id)
                              )
                            }
                            className="rounded-full border border-[#365a94] px-2 py-1 text-[10px] text-[#c6d6f7]"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {listingStepError && (
                  <div className="rounded-2xl border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-[11px] text-[#b3261e]">
                    {listingStepError}
                  </div>
                )}
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
                    className="rounded-full border border-[#365a94] px-4 py-2 text-xs text-[#c6d6f7]"
                  >
                    Back
                  </button>
                )}
              </div>
              <div className="flex flex-col items-end gap-2 text-[10px] text-[#d6e5ff]">
                {listingStep < 3 ? (
                  <>
                    <span>Saved as draft. You can finish later.</span>
                  <button
                    type="button"
                    onClick={async () => {
                      if (listingStep === 1 && !validateListingStepOne()) {
                        return;
                      }
                      if (listingStep === 2 && !validateListingStepTwo()) {
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

      {anchorMapOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-3xl border border-[#284675] bg-[#09142b]/70 p-6 shadow-[0_30px_70px_-40px_rgba(20,17,15,0.6)]">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-[#d1a741]">
                  Plot location
                </p>
                <p className="mt-2 text-lg font-semibold text-[#f2f6ff]">
                  Pick the plot point
                </p>
                <p className="mt-1 text-xs text-[#c6d6f7]">
                  Tap the exact position of the plot on the satellite map.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAnchorMapOpen(false)}
                className="rounded-full border border-[#365a94] px-3 py-1 text-xs text-[#c6d6f7]"
              >
                Close
              </button>
            </div>
            <div className="mt-4 overflow-hidden rounded-3xl border border-[#284675] bg-[#09142b]/70">
              <div className="relative h-[420px] w-full">
                <div className="absolute right-4 top-4 z-10 w-[220px] rounded-2xl border border-[#284675] bg-[#09142b]/70/95 p-2 text-[11px] shadow-sm backdrop-blur">
                  <div className="flex items-center gap-2">
                    <input
                      value={anchorSearchQuery}
                      onChange={(event) => setAnchorSearchQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          runAnchorSearch();
                        }
                      }}
                      placeholder="Search places"
                      className="w-full rounded-full border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-[11px] text-[#f2f6ff]"
                    />
                    <button
                      type="button"
                      onClick={runAnchorSearch}
                      disabled={!anchorSearchQuery.trim() || anchorSearchLoading}
                      className="rounded-full bg-[#2454a0] px-3 py-2 text-[10px] font-semibold text-white disabled:opacity-60"
                    >
                      {anchorSearchLoading ? "..." : "Go"}
                    </button>
                  </div>
                  {anchorSearchError && (
                    <p className="mt-2 text-[10px] text-[#b3261e]">
                      {anchorSearchError}
                    </p>
                  )}
                  {anchorSearchResults.length > 0 && (
                    <div className="mt-2 max-h-40 overflow-auto rounded-xl border border-[#284675] bg-[#09142b]/70">
                      {anchorSearchResults.map((result) => (
                        <button
                          key={result.id}
                          type="button"
                          onClick={() => {
                            setAnchorSearchResults([]);
                            anchorMapInstanceRef.current?.setCenter({
                              lat: result.center[1],
                              lng: result.center[0],
                            });
                            anchorMapInstanceRef.current?.setZoom(16);
                          }}
                          className="block w-full border-b border-[#f1e6d7] px-3 py-2 text-left text-[10px] text-[#c6d6f7] hover:bg-[#09142b]/70"
                        >
                          {result.place_name}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-[10px] text-[#9eb6e1]">
                    Search uses Google Maps geocoding.
                  </p>
                </div>
                <div ref={anchorMapRef} className="h-full w-full" />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-[#c6d6f7]">
              <span>
                Selected location:{" "}
                {anchorTrueCoord
                  ? `${anchorTrueCoord.lat.toFixed(6)}, ${anchorTrueCoord.lng.toFixed(
                      6
                    )}`
                  : "None"}
              </span>
              <button
                type="button"
                onClick={() => setAnchorMapOpen(false)}
                className="rounded-full bg-[#2454a0] px-4 py-2 text-xs font-semibold text-white"
              >
                Use this location
              </button>
            </div>
          </div>
        </div>
      )}

      {mapPreviewOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-3xl border border-[#284675] bg-[#09142b]/70 p-6 shadow-[0_30px_70px_-40px_rgba(20,17,15,0.6)]">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-[#d1a741]">
                  Parcel map preview
                </p>
                <p className="mt-2 text-lg font-semibold text-[#f2f6ff]">
                  Adjust parcel positions
                </p>
                <p className="mt-1 text-xs text-[#c6d6f7]">
                  Drag any parcel boundary to reposition it on the map.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMapPreviewOpen(false)}
                className="rounded-full border border-[#365a94] px-3 py-1 text-xs text-[#c6d6f7]"
              >
                Close
              </button>
            </div>
            <div className="mt-4 overflow-hidden rounded-3xl border border-[#284675] bg-[#09142b]/70">
              <div className="relative h-[420px] w-full">
                <div className="absolute right-4 top-4 z-10 w-[220px] rounded-2xl border border-[#284675] bg-[#09142b]/70/95 p-2 text-[11px] shadow-sm backdrop-blur">
                  <div className="flex items-center gap-2">
                    <input
                      value={mapSearchQuery}
                      onChange={(event) => setMapSearchQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          runMapSearch();
                        }
                      }}
                      placeholder="Search places"
                      className="w-full rounded-full border border-[#284675] bg-[#09142b]/70 px-3 py-2 text-[11px] text-[#f2f6ff]"
                    />
                    <button
                      type="button"
                      onClick={runMapSearch}
                      disabled={!mapSearchQuery.trim() || mapSearchLoading}
                      className="rounded-full bg-[#2454a0] px-3 py-2 text-[10px] font-semibold text-white disabled:opacity-60"
                    >
                      {mapSearchLoading ? "..." : "Go"}
                    </button>
                  </div>
                  {mapSearchError && (
                    <p className="mt-2 text-[10px] text-[#b3261e]">
                      {mapSearchError}
                    </p>
                  )}
                  {mapSearchResults.length > 0 && (
                    <div className="mt-2 max-h-40 overflow-auto rounded-xl border border-[#284675] bg-[#09142b]/70">
                      {mapSearchResults.map((result) => (
                        <button
                          key={result.id}
                          type="button"
                          onClick={() => {
                            setMapSearchResults([]);
                            mapPreviewInstanceRef.current?.setCenter({
                              lat: result.center[1],
                              lng: result.center[0],
                            });
                            mapPreviewInstanceRef.current?.setZoom(16);
                          }}
                          className="block w-full border-b border-[#f1e6d7] px-3 py-2 text-left text-[10px] text-[#c6d6f7] hover:bg-[#09142b]/70"
                        >
                          {result.place_name}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-[10px] text-[#9eb6e1]">
                    Search uses Google Maps geocoding.
                  </p>
                </div>
                <div ref={mapPreviewRef} className="h-full w-full" />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-[#c6d6f7]">
              <span>Tip: Click and drag a parcel to nudge its position.</span>
              <button
                type="button"
                onClick={() => setMapPreviewOpen(false)}
                className="rounded-full bg-[#2454a0] px-4 py-2 text-xs font-semibold text-white"
              >
                Save positions
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  ) : (
    loadingView
  );
}

