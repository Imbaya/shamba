"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import MapboxMap, { type Plot } from "./components/MapboxMap";
import { auth, db, storage } from "../lib/firebase";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { collection, doc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

export default function Home() {
  const router = useRouter();
  const [remotePlots, setRemotePlots] = useState<Plot[]>([]);
  const plots: Plot[] = [];

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
          parcels?: { name?: string; cleanPath?: { lat: number; lng: number }[] }[];
          nodes?: { label?: string; imageUrl?: string }[];
        };
        const parcels = data.parcels ?? [];
        const nodes = data.nodes ?? [];
        const priceLabel =
          data.price && data.price.toLowerCase().includes("ksh")
            ? data.price
            : data.price
            ? `Ksh ${data.price}`
            : "Ksh 0";
        const totalParcels = parcels.length || 1;

        const addPlotFromPath = (
          cleanPath: { lat: number; lng: number }[],
          idx: number,
          parcelName?: string
        ) => {
          if (cleanPath.length < 3) return;
          const polygon = cleanPath.map((point) => [point.lng, point.lat]) as [
            number,
            number
          ][];
          const center = polygon.reduce(
            (acc, point) => [acc[0] + point[0], acc[1] + point[1]],
            [0, 0]
          );
          const centerLngLat: [number, number] = [
            center[0] / polygon.length,
            center[1] / polygon.length,
          ];
          mapped.push({
            id: `${docSnap.id}-${idx}`,
            label:
              parcelName ||
              (data.name ? `${data.name} · Parcel ${idx + 1}` : `Parcel ${idx + 1}`),
            size: data.acres || "",
            price: priceLabel,
            center: centerLngLat,
            startPoint: polygon[0],
            polygon,
            vendor: data.vendorName || "Vendor",
            vendorId: data.vendorId,
            vendorType: data.vendorType || "Individual",
            amenities: data.amenities || [],
            totalParcels,
            availableParcels: totalParcels,
            nodes,
          });
        };

        if (parcels.length) {
          parcels.forEach((parcel, idx) =>
            addPlotFromPath(parcel.cleanPath ?? [], idx, parcel.name)
          );
          return;
        }

        addPlotFromPath([], 0);
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

  const [selectedVendor, setSelectedVendor] = useState("All vendors");
  const [vendorType, setVendorType] = useState<"All" | "Company" | "Individual">(
    "All"
  );
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [signupVendorType, setSignupVendorType] = useState<
    "Individual" | "Company"
  >("Individual");
  const [vendorName, setVendorName] = useState("");
  const [vendorEmail, setVendorEmail] = useState("");
  const [vendorPhone, setVendorPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyReg, setCompanyReg] = useState("");
  const [companyRegFile, setCompanyRegFile] = useState<File | null>(null);
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirm, setSignupConfirm] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const filteredPlots = useMemo(() => {
    return allPlots.filter((plot) => {
      if (selectedVendor !== "All vendors" && plot.vendor !== selectedVendor) {
        return false;
      }
      if (vendorType !== "All" && plot.vendorType !== vendorType) {
        return false;
      }
      if (selectedAmenities.length > 0) {
        return selectedAmenities.every((amenity) =>
          plot.amenities.includes(amenity)
        );
      }
      return true;
    });
  }, [allPlots, selectedAmenities, selectedVendor, vendorType]);

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
    if (signupVendorType === "Individual" && !vendorName) {
      setAuthError("Full name is required.");
      return;
    }
    if (signupVendorType === "Company" && !companyName) {
      setAuthError("Company name is required.");
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
      let registrationDocUrl = "";
      if (signupVendorType === "Company" && companyRegFile) {
        const fileRef = ref(
          storage,
          `vendor_docs/${userId}/company-registration-${companyRegFile.name}`
        );
        await uploadBytes(fileRef, companyRegFile);
        registrationDocUrl = await getDownloadURL(fileRef);
      }
      await setDoc(doc(db, "vendors", userId), {
        type: signupVendorType,
        name: signupVendorType === "Individual" ? vendorName : companyName,
        email: vendorEmail,
        phone: vendorPhone,
        companyRegNumber: signupVendorType === "Company" ? companyReg : "",
        registrationDocUrl,
        createdAt: serverTimestamp(),
      });
      setSignupOpen(false);
      router.push("/vendor");
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
      router.push("/vendor");
    } catch (error) {
      setAuthError("Login failed. Check your credentials.");
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#f9f1e6,_#f2ede4_55%,_#efe7d8)] text-[#14110f]">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#1f3d2d] text-lg font-semibold text-[#f4f1ea]">
            PT
          </div>
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-[#1f3d2d]">
              PlotTrust
            </p>
            <p className="text-xs text-[#3a2f2a]">Ground-truth land listings</p>
          </div>
        </div>
        <div className="hidden items-center gap-3 text-sm font-medium md:flex">
          <button
            className="rounded-full border border-[#1f3d2d]/30 px-4 py-2 text-[#1f3d2d] transition hover:border-[#1f3d2d]"
            onClick={() => setLoginOpen(true)}
          >
            Manage property
          </button>
          <button
            className="rounded-full bg-[#1f3d2d] px-5 py-2 text-[#f7f3ea] transition hover:bg-[#173124]"
            onClick={() => setSignupOpen(true)}
          >
            List a plot
          </button>
        </div>
      </div>
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 pb-4 sm:px-6 md:hidden">
        <button
          className="flex-1 rounded-full border border-[#1f3d2d]/30 px-4 py-2 text-sm font-semibold text-[#1f3d2d] transition hover:border-[#1f3d2d]"
          onClick={() => setLoginOpen(true)}
        >
          Manage property
        </button>
        <button
          className="flex-1 rounded-full bg-[#1f3d2d] px-4 py-2 text-sm font-semibold text-[#f7f3ea] transition hover:bg-[#173124]"
          onClick={() => setSignupOpen(true)}
        >
          List a plot
        </button>
      </div>

      <main className="mx-auto grid max-w-7xl gap-8 px-4 pb-16 pt-4 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
        <section className="order-2 hidden min-h-[720px] flex-col rounded-3xl bg-[#fbf8f3] p-5 shadow-[0_20px_60px_-40px_rgba(20,17,15,0.5)] lg:order-1 lg:flex">
          <p className="text-xs uppercase tracking-[0.35em] text-[#c77d4b]">
            Live map
          </p>
          <h1 className="mt-3 font-serif text-2xl leading-tight text-[#14110f]">
            Walk the land before you arrive.
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#3a2f2a]">
            Every listing has a walked perimeter, a confidence score, and a
            visual path from the nearest landmark.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium">
            <button className="rounded-full bg-[#c77d4b] px-3 py-2 text-[#fef7ee] transition hover:bg-[#b86e3d]">
              Explore verified
            </button>
            <button className="rounded-full border border-[#c77d4b]/30 px-3 py-2 text-[#6b3e1e] transition hover:border-[#c77d4b]">
              Start a capture
            </button>
          </div>

          <div className="mt-6 rounded-3xl border border-[#eadfce] bg-white p-4">
            <p className="text-[10px] uppercase tracking-[0.35em] text-[#a67047]">
              Filters
            </p>
            <div className="mt-3 space-y-3 text-xs text-[#4b3b35]">
              <div>
                <p className="text-[11px] font-semibold text-[#14110f]">
                  Vendor
                </p>
                <select
                  className="mt-2 w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-xs text-[#14110f]"
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
                <p className="text-[11px] font-semibold text-[#14110f]">
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
                <p className="text-[11px] font-semibold text-[#14110f]">
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
              <button
                type="button"
                onClick={() => {
                  setSelectedVendor("All vendors");
                  setVendorType("All");
                  setSelectedAmenities([]);
                }}
                className="rounded-full border border-[#eadfce] px-3 py-2 text-[11px] text-[#5a4a44]"
              >
                Clear filters
              </button>
            </div>
          </div>
        </section>

        <section className="relative order-1 lg:order-2">
          <MapboxMap
            plots={filteredPlots.map((plot) => ({
              id: plot.id,
              label: plot.label,
              size: plot.size,
              price: plot.price,
              vendor: plot.vendor,
              vendorType: plot.vendorType,
              amenities: plot.amenities,
              center: plot.center,
              polygon: plot.polygon,
              startPoint: plot.startPoint,
              totalParcels: plot.totalParcels,
              availableParcels: plot.availableParcels,
            }))}
          />

          <div className="pointer-events-none absolute left-4 top-4 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-[#1f3d2d] backdrop-blur sm:left-6 sm:top-6">
            Western District
          </div>

          <div className="absolute right-4 top-4 z-30 lg:hidden sm:right-6 sm:top-6">
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="rounded-full bg-[#1f3d2d] px-4 py-2 text-xs font-semibold text-white shadow-lg ring-2 ring-white/70"
            >
              Filters
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-[#3a2f2a] sm:gap-3 sm:text-xs">
            <span className="rounded-full border border-[#eadfce] bg-white px-3 py-1">
              Confidence scores shown
            </span>
            <span className="rounded-full border border-[#eadfce] bg-white px-3 py-1">
              Walked perimeter overlays
            </span>
            <span className="rounded-full border border-[#eadfce] bg-white px-3 py-1">
              4G-ready PWA map
            </span>
          </div>

          {filtersOpen && (
            <div className="absolute inset-0 z-20 flex items-start justify-center bg-black/30 px-4 py-6 lg:hidden">
              <div className="relative w-full max-w-md max-h-[85vh] overflow-y-auto rounded-3xl border border-[#eadfce] bg-[#fbf8f3] p-5 shadow-[0_20px_60px_-40px_rgba(20,17,15,0.5)]">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.35em] text-[#a67047]">
                    Filters
                  </p>
                  <button
                    type="button"
                    onClick={() => setFiltersOpen(false)}
                    className="rounded-full border border-[#eadfce] px-3 py-1 text-xs text-[#5a4a44]"
                  >
                    Close
                  </button>
                </div>
                <div className="mt-4 space-y-4 text-xs text-[#4b3b35]">
                  <div>
                    <p className="text-[11px] font-semibold text-[#14110f]">
                      Vendor
                    </p>
                    <select
                      className="mt-2 w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-xs text-[#14110f]"
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
                    <p className="text-[11px] font-semibold text-[#14110f]">
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
                    <p className="text-[11px] font-semibold text-[#14110f]">
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
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedVendor("All vendors");
                        setVendorType("All");
                        setSelectedAmenities([]);
                      }}
                      className="rounded-full border border-[#eadfce] px-3 py-2 text-[11px] text-[#5a4a44]"
                    >
                      Clear filters
                    </button>
                    <button
                      type="button"
                      onClick={() => setFiltersOpen(false)}
                      className="rounded-full bg-[#1f3d2d] px-4 py-2 text-[11px] text-white"
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

      <div className="border-t border-[#eadfce] px-6 py-6 text-xs text-[#5a4a44]" />

      {signupOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl border border-[#eadfce] bg-[#fbf8f3] p-6 shadow-[0_30px_70px_-40px_rgba(20,17,15,0.6)]">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-[#a67047]">
                  Vendor signup
                </p>
                <p className="mt-2 font-serif text-xl text-[#14110f]">
                  Create a vendor account
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSignupOpen(false)}
                className="rounded-full border border-[#eadfce] px-3 py-1 text-xs text-[#5a4a44]"
              >
                Close
              </button>
            </div>

            <div className="mt-5 space-y-4 text-xs">
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-[#a67047]">
                  I am registering as
                </label>
                <div className="mt-2 flex gap-2">
                  {["Individual", "Company"].map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() =>
                        setSignupVendorType(type as "Individual" | "Company")
                      }
                      className={`rounded-full px-3 py-2 text-xs transition ${
                        signupVendorType === type
                          ? "bg-[#1f3d2d] text-white"
                          : "border border-[#eadfce] bg-white text-[#5a4a44]"
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>
              {signupVendorType === "Individual" ? (
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
              ) : (
                <div className="grid gap-3">
                  <input
                    type="text"
                    value={companyName ?? ""}
                    onChange={(event) => setCompanyName(event.target.value)}
                    placeholder="Company name"
                    className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                  />
                  <input
                    type="text"
                    value={companyReg ?? ""}
                    onChange={(event) => setCompanyReg(event.target.value)}
                    placeholder="Registration number"
                    className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                  />
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    onChange={(event) =>
                      setCompanyRegFile(event.target.files?.[0] ?? null)
                    }
                    className="w-full text-xs text-[#5a4a44] file:mr-3 file:rounded-full file:border-0 file:bg-[#c77d4b] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
                  />
                  <input
                    type="email"
                    value={vendorEmail ?? ""}
                    onChange={(event) => setVendorEmail(event.target.value)}
                    placeholder="Company email"
                    className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                  />
                  <input
                    type="tel"
                    value={vendorPhone ?? ""}
                    onChange={(event) =>
                      setVendorPhone(event.target.value ?? "")
                    }
                    placeholder="Company phone"
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
              )}
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
          <div className="w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-3xl border border-[#eadfce] bg-[#fbf8f3] p-6 shadow-[0_30px_70px_-40px_rgba(20,17,15,0.6)]">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-[#a67047]">
                  Vendor login
                </p>
                <p className="mt-2 font-serif text-xl text-[#14110f]">
                  Manage property
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLoginOpen(false)}
                className="rounded-full border border-[#eadfce] px-3 py-1 text-xs text-[#5a4a44]"
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
