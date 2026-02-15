"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import MapboxMap, { type Plot } from "./components/MapboxMap";
import { auth, db } from "../lib/firebase";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { collection, doc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";

export default function Home() {
  const router = useRouter();
  const [remotePlots, setRemotePlots] = useState<Plot[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [mobileMapOffset, setMobileMapOffset] = useState(136);
  const [sharedListingId, setSharedListingId] = useState("");
  const plots: Plot[] = [];

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    const updateViewportSizing = () => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const mobile = viewportWidth < 768;
      setIsMobileViewport(mobile);
      if (!mobile) return;

      // Tune chrome/header allowance by device height for tighter fit on small screens.
      let offset = 136;
      if (viewportHeight <= 680) {
        offset = 106; // iPhone SE and similar compact devices
      } else if (viewportHeight <= 740) {
        offset = 114;
      } else if (viewportHeight <= 820) {
        offset = 122;
      } else {
        offset = 130;
      }
      setMobileMapOffset(offset);
    };

    updateViewportSizing();
    window.addEventListener("resize", updateViewportSizing);
    window.addEventListener("orientationchange", updateViewportSizing);
    const params = new URLSearchParams(window.location.search);
    setSharedListingId(params.get("listing")?.trim() ?? "");
    return () => {
      window.removeEventListener("resize", updateViewportSizing);
      window.removeEventListener("orientationchange", updateViewportSizing);
    };
  }, []);

  useEffect(() => {
    const loadListings = async () => {
      const snapshot = await getDocs(collection(db, "listings"));
      const mapped: Plot[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as {
          name?: string;
          acres?: string;
          price?: string;
          amenities?: string[];
          vendorName?: string;
          vendorType?: "Company" | "Individual";
          vendorId?: string;
          portalId?: string | null;
          soldParcelIds?: number[];
          plotLocation?: { lat?: number; lng?: number };
          parcels?: { name?: string; cleanPath?: { lat: number; lng: number }[] }[];
          parcelCount?: number;
          surroundingImages?: { name?: string; url?: string }[];
          mutationForm?: { name?: string; url?: string } | null;
          mutationParcels?: {
            parcelNumber?: number;
            confidence?: number;
            points?: { x?: number; y?: number }[];
          }[];
          soldParcelOverlays?: {
            parcelNumber?: number;
            confidence?: number;
            points?: { x?: number; y?: number }[];
          }[];
          manualParcelOverlays?: {
            parcelNumber?: number;
            confidence?: number;
            points?: { x?: number; y?: number }[];
          }[];
        };
        const parcels = data.parcels ?? [];
        const soldParcelIds = data.soldParcelIds ?? [];
        const surroundingImages = data.surroundingImages ?? [];
        const priceLabel =
          data.price && data.price.toLowerCase().includes("ksh")
            ? data.price
            : data.price
            ? `Ksh ${data.price}`
            : "Ksh 0";
        const totalParcels = data.parcelCount || parcels.length || 1;
        const availableParcels = Math.max(totalParcels - soldParcelIds.length, 0);
        const firstPath =
          parcels.find((parcel) => (parcel.cleanPath?.length ?? 0) >= 3)
            ?.cleanPath ?? [];
        const polygon = firstPath.map((point) => [point.lng, point.lat]) as [
          number,
          number
        ][];
        const centerFromPolygon: [number, number] | null =
          polygon.length >= 3
            ? [
                polygon.reduce((sum, point) => sum + point[0], 0) / polygon.length,
                polygon.reduce((sum, point) => sum + point[1], 0) / polygon.length,
              ]
            : null;
        const centerFromPin =
          typeof data.plotLocation?.lng === "number" &&
          typeof data.plotLocation?.lat === "number"
            ? ([data.plotLocation.lng, data.plotLocation.lat] as [number, number])
            : null;
        const center = centerFromPin ?? centerFromPolygon;
        if (!center) return;
        mapped.push({
          id: docSnap.id,
          label: data.name || "Parcel",
          size: data.acres || "",
          price: priceLabel,
          center,
          startPoint: center,
          polygon: polygon.length >= 3 ? polygon : undefined,
          vendor: data.vendorName || "Vendor",
          vendorId: data.vendorId,
          portalId: data.portalId ?? null,
          vendorType: data.vendorType || "Individual",
          amenities: data.amenities || [],
          totalParcels,
          availableParcels,
          isSold: availableParcels <= 0,
          soldParcelIds,
          surroundingImages,
          mutationForm: data.mutationForm ?? undefined,
          mutationParcels: (data.mutationParcels ?? [])
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
            .filter(
              (parcel) => parcel.parcelNumber > 0 && parcel.points.length >= 3
            ),
          soldParcelOverlays: (data.soldParcelOverlays ?? [])
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
          manualParcelOverlays: (data.manualParcelOverlays ?? [])
            .map((overlay) => ({
              parcelNumber: Number(overlay.parcelNumber),
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
                Number.isFinite(overlay.parcelNumber) &&
                overlay.parcelNumber > 0 &&
                overlay.points.length >= 3
            ) as Plot["manualParcelOverlays"],
        });
      });
      setRemotePlots(mapped);
    };
    loadListings();
  }, []);

  const allPlots = useMemo(() => [...remotePlots, ...plots], [remotePlots]);

  const vendorOptions = useMemo(
    () => Array.from(new Set(allPlots.map((plot) => plot.vendor))),
    [allPlots]
  );
  const amenityOptions = useMemo(
    () =>
      Array.from(new Set(allPlots.flatMap((plot) => plot.amenities))).sort(),
    [allPlots]
  );
  const sharedListingPlot = useMemo(
    () =>
      sharedListingId
        ? allPlots.find((plot) => plot.id === sharedListingId) ?? null
        : null,
    [allPlots, sharedListingId]
  );

  const [selectedVendor, setSelectedVendor] = useState("All vendors");
  const [vendorType, setVendorType] = useState<"All" | "Company" | "Individual">(
    "All"
  );
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [minPriceFilter, setMinPriceFilter] = useState("");
  const [maxPriceFilter, setMaxPriceFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [vendorName, setVendorName] = useState("");
  const [vendorEmail, setVendorEmail] = useState("");
  const [vendorPhone, setVendorPhone] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirm, setSignupConfirm] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const parsePlotPrice = (price: string) => {
    const numeric = Number(price.replace(/[^0-9.]/g, ""));
    return Number.isFinite(numeric) ? numeric : 0;
  };

  const filteredPlots = useMemo(() => {
    if (sharedListingPlot) {
      return [sharedListingPlot];
    }
    const min = Number(minPriceFilter.replace(/[^0-9.]/g, ""));
    const max = Number(maxPriceFilter.replace(/[^0-9.]/g, ""));
    return allPlots.filter((plot) => {
      if (selectedVendor !== "All vendors" && plot.vendor !== selectedVendor) {
        return false;
      }
      if (vendorType !== "All" && plot.vendorType !== vendorType) {
        return false;
      }
      const price = parsePlotPrice(plot.price);
      if (Number.isFinite(min) && min > 0 && price < min) {
        return false;
      }
      if (Number.isFinite(max) && max > 0 && price > max) {
        return false;
      }
      if (selectedAmenities.length > 0) {
        return selectedAmenities.every((amenity) =>
          plot.amenities.includes(amenity)
        );
      }
      return true;
    });
  }, [
    allPlots,
    maxPriceFilter,
    minPriceFilter,
    selectedAmenities,
    selectedVendor,
    sharedListingPlot,
    vendorType,
  ]);

  const handleSignup = async () => {
    setAuthError(null);
    if (!vendorEmail || !signupPassword || !signupConfirm) {
      setAuthError("Email and password are required.");
      return;
    }
    if (signupPassword !== signupConfirm) {
      setAuthError("Passwords do not match.");
      return;
    }
    if (!vendorName) {
      setAuthError("Full name is required.");
      return;
    }
    setAuthLoading(true);
    try {
      const credential = await createUserWithEmailAndPassword(
        auth,
        vendorEmail,
        signupPassword
      );
      const userId = credential.user.uid;
      await setDoc(doc(db, "users", userId), {
        name: vendorName,
        email: vendorEmail,
        emailLower: vendorEmail.toLowerCase(),
        phone: vendorPhone,
        createdAt: serverTimestamp(),
      });
      setSignupOpen(false);
      router.push("/portal");
    } catch (error) {
      setAuthError("Signup failed. Check your details and try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogin = async () => {
    setAuthError(null);
    if (!loginEmail || !loginPassword) {
      setAuthError("Email and password are required.");
      return;
    }
    setAuthLoading(true);
    try {
      await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
      setLoginOpen(false);
      router.push("/portal");
    } catch (error) {
      setAuthError("Login failed. Check your credentials.");
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <div className="h-[100dvh] overflow-hidden bg-[radial-gradient(circle_at_12%_10%,_rgba(209,167,65,0.22),_transparent_28%),radial-gradient(circle_at_88%_12%,_rgba(74,160,255,0.2),_transparent_34%),linear-gradient(120deg,_#050b1a_0%,_#07122a_45%,_#091631_100%)] text-[#e8eefc] md:min-h-screen md:h-auto md:overflow-x-hidden">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:flex-nowrap sm:px-6 sm:py-6">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl bg-[#0d1f3f]"
            suppressHydrationWarning
          >
            {hydrated ? (
              <img src="/logo.png" alt="PlotTrust logo" className="h-8 w-8" />
            ) : (
              <span className="text-lg font-semibold text-[#f6f9ff]">PT</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs uppercase tracking-[0.25em] text-[#a9c7ff] sm:text-sm sm:tracking-[0.3em]">
              PlotTrust
            </p>
            <p className="truncate text-[11px] text-[#c6d6f7] sm:text-xs">
              Ground-truth land listings
            </p>
          </div>
        </div>
        <div className="hidden items-center gap-3 text-sm font-medium md:flex">
          <button
            className="rounded-full border border-[#4a78c7]/60 bg-[#09142b]/70 px-4 py-2 text-[#cfe1ff] transition hover:border-[#6f9df0]"
            onClick={() => setLoginOpen(true)}
          >
            Manage property
          </button>
          <button
            className="rounded-full bg-[#d1a741] px-5 py-2 text-[#091631] transition hover:bg-[#dfbc66]"
            onClick={() => setSignupOpen(true)}
          >
            Register
          </button>
        </div>
      </div>
      <div className="mx-auto grid max-w-6xl grid-cols-3 items-stretch gap-2 px-4 pb-2 sm:px-6 md:hidden">
        <button
          className="w-full rounded-full border border-[#4a78c7]/60 bg-[#09142b]/70 px-2 py-2 text-[11px] font-semibold leading-tight text-[#cfe1ff] transition hover:border-[#6f9df0]"
          onClick={() => setFiltersOpen(true)}
        >
          Filters
        </button>
        <button
          className="w-full rounded-full border border-[#4a78c7]/60 bg-[#09142b]/70 px-2 py-2 text-[11px] font-semibold leading-tight text-[#cfe1ff] transition hover:border-[#6f9df0]"
          onClick={() => setLoginOpen(true)}
        >
          Manage property
        </button>
        <button
          className="w-full rounded-full bg-[#d1a741] px-2 py-2 text-[11px] font-semibold leading-tight text-[#091631] transition hover:bg-[#dfbc66]"
          onClick={() => setSignupOpen(true)}
        >
          Register
        </button>
      </div>

      <main
        className="mx-auto grid max-w-7xl gap-4 px-4 pb-0 pt-1 sm:gap-8 sm:px-6 sm:pt-4 md:h-auto md:pb-16 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)] lg:items-start"
        style={isMobileViewport ? { height: `calc(100dvh - ${mobileMapOffset}px)` } : undefined}
      >
        <section className="order-2 hidden min-h-[720px] flex-col rounded-3xl border border-[#284675] bg-[#09142b]/82 p-5 shadow-[0_25px_70px_-45px_rgba(0,0,0,0.9)] backdrop-blur lg:order-1 lg:flex">
          <p className="text-xs uppercase tracking-[0.35em] text-[#d1a741]">
            Live map
          </p>
          <h1 className="mt-3 font-serif text-2xl leading-tight text-[#f2f6ff]">
            Walk the land before you arrive.
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#c6d6f7]">
            Every listing has a walked perimeter, a confidence score, and a
            visual path from the nearest landmark.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium">
            <button className="rounded-full bg-[#d1a741] px-3 py-2 text-[#091631] transition hover:bg-[#dfbc66]">
              Explore verified
            </button>
            <button className="rounded-full border border-[#4a78c7]/60 px-3 py-2 text-[#d6e5ff] transition hover:border-[#6f9df0]">
              Start a capture
            </button>
          </div>

          <div className="mt-6 rounded-3xl border border-[#284675] bg-[#0a1834]/85 p-4">
            <p className="text-[10px] uppercase tracking-[0.35em] text-[#d1a741]">
              Filters
            </p>
            <div className="mt-3 space-y-3 text-xs text-[#c6d6f7]">
              <div>
                <p className="text-[11px] font-semibold text-[#e8eefc]">
                  Vendor
                </p>
                <select
                  className="mt-2 w-full rounded-2xl border border-[#365a94] bg-[#0d1f3f] px-3 py-2 text-xs text-[#e8eefc]"
                  value={selectedVendor}
                  onChange={(event) => setSelectedVendor(event.target.value)}
                >
                  <option>All vendors</option>
                  {vendorOptions.map((vendor) => (
                    <option key={vendor}>{vendor}</option>
                  ))}
                </select>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-[#e8eefc]">
                  Vendor type
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  {["All", "Company", "Individual"].map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() =>
                        setVendorType(type as "All" | "Company" | "Individual")
                      }
                      className={`rounded-full px-3 py-1 text-[11px] transition ${
                        vendorType === type
                          ? "bg-[#1f3d2d] text-white"
                          : "border border-[#eadfce] bg-white text-[#5a4a44]"
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-[#e8eefc]">
                  Amenities stated by vendor
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  {amenityOptions.map((amenity) => {
                    const isActive = selectedAmenities.includes(amenity);
                    return (
                      <button
                        key={amenity}
                        type="button"
                        onClick={() =>
                          setSelectedAmenities((current) =>
                            isActive
                              ? current.filter((item) => item !== amenity)
                              : [...current, amenity]
                          )
                        }
                        className={`rounded-full px-3 py-1 text-[11px] transition ${
                          isActive
                            ? "bg-[#c77d4b] text-white"
                            : "border border-[#eadfce] bg-white text-[#6b3e1e]"
                        }`}
                      >
                        {amenity}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-[#e8eefc]">Price range (Ksh)</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min="0"
                    value={minPriceFilter}
                    onChange={(event) => setMinPriceFilter(event.target.value)}
                    placeholder="Min"
                    className="w-full rounded-2xl border border-[#365a94] bg-[#0d1f3f] px-3 py-2 text-xs text-[#e8eefc] placeholder:text-[#95add8]"
                  />
                  <input
                    type="number"
                    min="0"
                    value={maxPriceFilter}
                    onChange={(event) => setMaxPriceFilter(event.target.value)}
                    placeholder="Max"
                    className="w-full rounded-2xl border border-[#365a94] bg-[#0d1f3f] px-3 py-2 text-xs text-[#e8eefc] placeholder:text-[#95add8]"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedVendor("All vendors");
                  setVendorType("All");
                  setSelectedAmenities([]);
                  setMinPriceFilter("");
                  setMaxPriceFilter("");
                }}
                className="rounded-full border border-[#365a94] px-3 py-2 text-[11px] text-[#d6e5ff]"
              >
                Clear filters
              </button>
            </div>
          </div>
        </section>

        <section className="relative order-1 min-w-0 h-full lg:order-2">
          <MapboxMap
            plots={filteredPlots.map((plot) => ({
              id: plot.id,
              label: plot.label,
              size: plot.size,
              price: plot.price,
              vendor: plot.vendor,
              vendorId: plot.vendorId,
              vendorType: plot.vendorType,
              amenities: plot.amenities,
              center: plot.center,
              polygon: plot.polygon,
              startPoint: plot.startPoint,
              totalParcels: plot.totalParcels,
              availableParcels: plot.availableParcels,
              soldParcelIds: plot.soldParcelIds,
              surroundingImages: plot.surroundingImages,
              mutationForm: plot.mutationForm,
              mutationParcels: plot.mutationParcels,
              soldParcelOverlays: plot.soldParcelOverlays,
              manualParcelOverlays: plot.manualParcelOverlays,
            }))}
            onFiltersClick={() => setFiltersOpen(true)}
            compactMobile
            autoOpenPlotId={sharedListingPlot?.id ?? null}
          />

          <div className="pointer-events-none absolute left-3 top-3 max-w-[calc(100%-1.5rem)] truncate rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold text-[#1f3d2d] backdrop-blur sm:left-6 sm:top-6 sm:max-w-none sm:text-xs">
            Western District
          </div>

          {filtersOpen && (
            <div className="absolute inset-0 z-20 flex items-start justify-center bg-black/30 px-4 py-6 lg:hidden">
              <div className="relative w-full max-w-md max-h-[85vh] overflow-y-auto rounded-3xl border border-[#284675] bg-[#0a1834]/95 p-5 shadow-[0_20px_60px_-40px_rgba(0,0,0,0.9)]">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.35em] text-[#d1a741]">
                    Filters
                  </p>
                  <button
                    type="button"
                    onClick={() => setFiltersOpen(false)}
                    className="rounded-full border border-[#365a94] px-3 py-1 text-xs text-[#d6e5ff]"
                  >
                    Close
                  </button>
                </div>
                <div className="mt-4 space-y-4 text-xs text-[#c6d6f7]">
                  <div>
                    <p className="text-[11px] font-semibold text-[#e8eefc]">
                      Vendor
                    </p>
                    <select
                      className="mt-2 w-full rounded-2xl border border-[#365a94] bg-[#0d1f3f] px-3 py-2 text-xs text-[#e8eefc]"
                      value={selectedVendor}
                      onChange={(event) =>
                        setSelectedVendor(event.target.value)
                      }
                    >
                      <option>All vendors</option>
                      {vendorOptions.map((vendor) => (
                        <option key={vendor}>{vendor}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-[#e8eefc]">
                      Vendor type
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                      {["All", "Company", "Individual"].map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() =>
                            setVendorType(
                              type as "All" | "Company" | "Individual"
                            )
                          }
                          className={`rounded-full px-3 py-1 text-[11px] transition ${
                            vendorType === type
                              ? "bg-[#1f3d2d] text-white"
                              : "border border-[#eadfce] bg-white text-[#5a4a44]"
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-[#e8eefc]">
                      Amenities stated by vendor
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                      {amenityOptions.map((amenity) => {
                        const isActive = selectedAmenities.includes(amenity);
                        return (
                          <button
                            key={amenity}
                            type="button"
                            onClick={() =>
                              setSelectedAmenities((current) =>
                                isActive
                                  ? current.filter((item) => item !== amenity)
                                  : [...current, amenity]
                              )
                            }
                            className={`rounded-full px-3 py-1 text-[11px] transition ${
                              isActive
                                ? "bg-[#c77d4b] text-white"
                                : "border border-[#eadfce] bg-white text-[#6b3e1e]"
                            }`}
                          >
                            {amenity}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-[#e8eefc]">
                      Price range (Ksh)
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        min="0"
                        value={minPriceFilter}
                        onChange={(event) => setMinPriceFilter(event.target.value)}
                        placeholder="Min"
                        className="w-full rounded-2xl border border-[#365a94] bg-[#0d1f3f] px-3 py-2 text-xs text-[#e8eefc] placeholder:text-[#95add8]"
                      />
                      <input
                        type="number"
                        min="0"
                        value={maxPriceFilter}
                        onChange={(event) => setMaxPriceFilter(event.target.value)}
                        placeholder="Max"
                        className="w-full rounded-2xl border border-[#365a94] bg-[#0d1f3f] px-3 py-2 text-xs text-[#e8eefc] placeholder:text-[#95add8]"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedVendor("All vendors");
                        setVendorType("All");
                        setSelectedAmenities([]);
                        setMinPriceFilter("");
                        setMaxPriceFilter("");
                      }}
                      className="rounded-full border border-[#365a94] px-3 py-2 text-[11px] text-[#d6e5ff]"
                    >
                      Clear filters
                    </button>
                    <button
                      type="button"
                      onClick={() => setFiltersOpen(false)}
                      className="rounded-full bg-[#d1a741] px-4 py-2 text-[11px] text-[#091631]"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

        </section>
      </main>

      <div className="hidden border-t border-[#284675] px-4 py-6 text-xs text-[#95add8] sm:px-6 md:block" />

      {signupOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl border border-[#284675] bg-[#0a1834]/95 p-6 shadow-[0_30px_70px_-40px_rgba(0,0,0,0.9)]">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-[#d1a741]">
                  Vendor signup
                </p>
                <p className="mt-2 font-serif text-xl text-[#f2f6ff]">
                  Create a vendor account
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSignupOpen(false)}
                className="rounded-full border border-[#4a78c7]/60 px-3 py-1 text-xs text-[#d6e5ff]"
              >
                Close
              </button>
            </div>

            <div className="mt-5 space-y-4 text-xs">
              <div className="grid gap-3">
                <input
                  type="text"
                  value={vendorName ?? ""}
                  onChange={(event) => setVendorName(event.target.value)}
                  placeholder="Full name"
                  className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                />
                <input
                  type="email"
                  value={vendorEmail ?? ""}
                  onChange={(event) => setVendorEmail(event.target.value)}
                  placeholder="Email"
                  className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                />
                <input
                  type="tel"
                  value={vendorPhone ?? ""}
                  onChange={(event) =>
                    setVendorPhone(event.target.value ?? "")
                  }
                  placeholder="Phone number"
                  className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                />
                <input
                  type="password"
                  value={signupPassword}
                  onChange={(event) => setSignupPassword(event.target.value)}
                  placeholder="Password"
                  className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                />
                <input
                  type="password"
                  value={signupConfirm}
                  onChange={(event) => setSignupConfirm(event.target.value)}
                  placeholder="Confirm password"
                  className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                />
              </div>
            </div>

            {authError && (
              <div className="mt-4 rounded-2xl border border-[#eadfce] bg-white px-4 py-3 text-[11px] text-[#b3261e]">
                {authError}
              </div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setSignupOpen(false)}
                className="rounded-full border border-[#eadfce] px-4 py-2 text-xs text-[#5a4a44]"
                disabled={authLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSignup}
                className="rounded-full bg-[#1f3d2d] px-4 py-2 text-xs font-semibold text-white"
                disabled={authLoading}
              >
                {authLoading ? "Creating..." : "Create account"}
              </button>
            </div>
          </div>
        </div>
      )}

      {loginOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-3xl border border-[#284675] bg-[#0a1834]/95 p-6 shadow-[0_30px_70px_-40px_rgba(0,0,0,0.9)]">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-[#d1a741]">
                  Vendor login
                </p>
                <p className="mt-2 font-serif text-xl text-[#f2f6ff]">
                  Manage property
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLoginOpen(false)}
                className="rounded-full border border-[#4a78c7]/60 px-3 py-1 text-xs text-[#d6e5ff]"
              >
                Close
              </button>
            </div>

            <div className="mt-5 space-y-3">
              <input
                type="email"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                placeholder="Email"
                className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
              />
              <input
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                placeholder="Password"
                className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
              />
            </div>

            {authError && (
              <div className="mt-4 rounded-2xl border border-[#eadfce] bg-white px-4 py-3 text-[11px] text-[#b3261e]">
                {authError}
              </div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setLoginOpen(false)}
                className="rounded-full border border-[#eadfce] px-4 py-2 text-xs text-[#5a4a44]"
                disabled={authLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleLogin}
                className="rounded-full bg-[#1f3d2d] px-4 py-2 text-xs font-semibold text-white"
                disabled={authLoading}
              >
                {authLoading ? "Signing in..." : "Login"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
