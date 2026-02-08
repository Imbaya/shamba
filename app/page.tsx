"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import MapboxMap, { type Plot } from "./components/MapboxMap";

export default function Home() {
  const router = useRouter();
  const plots: Plot[] = [
    {
      id: "PT-204",
      label: "Redwood Ridge",
      size: "2.6 acres",
      price: "$48k",
      center: [36.6629, -1.2461],
      startPoint: [36.6606, -1.2435],
      polygon: [
        [36.6592, -1.2448],
        [36.6661, -1.2445],
        [36.6674, -1.2485],
        [36.6611, -1.2499],
        [36.6592, -1.2448],
      ],
      vendor: "Diallo Holdings",
      vendorType: "Company",
      amenities: ["Access road", "Water", "Power"],
      totalParcels: 5,
      availableParcels: 3,
    },
    {
      id: "PT-311",
      label: "Blue River Bend",
      size: "1.2 acres",
      price: "$26k",
      center: [36.6781, -1.2412],
      startPoint: [36.6761, -1.2381],
      polygon: [
        [36.6743, -1.2394],
        [36.6814, -1.2387],
        [36.6826, -1.2426],
        [36.6775, -1.2442],
        [36.6743, -1.2394],
      ],
      vendor: "Amina Diallo",
      vendorType: "Individual",
      amenities: ["River access"],
    },
    {
      id: "PT-517",
      label: "Koru Valley",
      size: "5.1 acres",
      price: "$71k",
      center: [36.6504, -1.2596],
      startPoint: [36.6482, -1.2562],
      polygon: [
        [36.6469, -1.2575],
        [36.6538, -1.2576],
        [36.6541, -1.2617],
        [36.6487, -1.2624],
        [36.6469, -1.2575],
      ],
      vendor: "Koru Estates Ltd",
      vendorType: "Company",
      amenities: ["Access road", "Power", "Mobile coverage"],
      totalParcels: 8,
      availableParcels: 6,
    },
    {
      id: "PT-622",
      label: "Mango Grove",
      size: "0.9 acres",
      price: "$19k",
      center: [36.6694, -1.2624],
      startPoint: [36.6674, -1.2601],
      polygon: [
        [36.6661, -1.2607],
        [36.6715, -1.2602],
        [36.6722, -1.2635],
        [36.6682, -1.2647],
        [36.6661, -1.2607],
      ],
      vendor: "J. Mensah",
      vendorType: "Individual",
      amenities: ["Well water"],
    },
  ];

  const vendorOptions = useMemo(
    () => Array.from(new Set(plots.map((plot) => plot.vendor))),
    [plots]
  );
  const amenityOptions = useMemo(
    () =>
      Array.from(new Set(plots.flatMap((plot) => plot.amenities))).sort(),
    [plots]
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

  const filteredPlots = useMemo(() => {
    return plots.filter((plot) => {
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
  }, [plots, selectedAmenities, selectedVendor, vendorType]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#f9f1e6,_#f2ede4_55%,_#efe7d8)] text-[#14110f]">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
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
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 pb-4 md:hidden">
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

      <main className="mx-auto grid max-w-7xl gap-10 px-6 pb-16 pt-4 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
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

          <div className="pointer-events-none absolute left-6 top-6 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-[#1f3d2d] backdrop-blur">
            Western District
          </div>

          <div className="absolute right-6 top-6 z-30 lg:hidden">
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="rounded-full bg-[#1f3d2d] px-4 py-2 text-xs font-semibold text-white shadow-lg ring-2 ring-white/70"
            >
              Filters
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-[#3a2f2a]">
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
            <div className="absolute inset-0 z-20 flex items-start justify-center bg-black/30 px-4 py-8 lg:hidden">
              <div className="relative w-full max-w-md rounded-3xl border border-[#eadfce] bg-[#fbf8f3] p-5 shadow-[0_20px_60px_-40px_rgba(20,17,15,0.5)]">
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
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-8">
          <div className="w-full max-w-lg rounded-3xl border border-[#eadfce] bg-[#fbf8f3] p-6 shadow-[0_30px_70px_-40px_rgba(20,17,15,0.6)]">
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
                    onChange={(event) => setVendorPhone(event.target.value)}
                    placeholder="Phone number"
                    className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                  />
                  <input
                    type="password"
                    placeholder="Password"
                    className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                  />
                  <input
                    type="password"
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
                    onChange={(event) => setVendorPhone(event.target.value)}
                    placeholder="Company phone"
                    className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                  />
                  <input
                    type="password"
                    placeholder="Password"
                    className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                  />
                  <input
                    type="password"
                    placeholder="Confirm password"
                    className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                  />
                </div>
              )}
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setSignupOpen(false)}
                className="rounded-full border border-[#eadfce] px-4 py-2 text-xs text-[#5a4a44]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setSignupOpen(false);
                  router.push("/vendor");
                }}
                className="rounded-full bg-[#1f3d2d] px-4 py-2 text-xs font-semibold text-white"
              >
                Create account
              </button>
            </div>
          </div>
        </div>
      )}

      {loginOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-8">
          <div className="w-full max-w-sm rounded-3xl border border-[#eadfce] bg-[#fbf8f3] p-6 shadow-[0_30px_70px_-40px_rgba(20,17,15,0.6)]">
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
                placeholder="Email"
                className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
              />
              <input
                type="password"
                placeholder="Password"
                className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
              />
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setLoginOpen(false)}
                className="rounded-full border border-[#eadfce] px-4 py-2 text-xs text-[#5a4a44]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setLoginOpen(false);
                  router.push("/vendor");
                }}
                className="rounded-full bg-[#1f3d2d] px-4 py-2 text-xs font-semibold text-white"
              >
                Login
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
