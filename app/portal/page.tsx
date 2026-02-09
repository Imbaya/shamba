"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "../../lib/firebase";

type PortalType = "company" | "individual";

type PortalSummary = {
  id: string;
  name: string;
  type: PortalType;
  location?: string;
  createdAt?: string;
};

export default function PortalPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [portals, setPortals] = useState<PortalSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [companyLocation, setCompanyLocation] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [companyLogo, setCompanyLogo] = useState<File | null>(null);
  const [companyCertificate, setCompanyCertificate] = useState<File | null>(
    null
  );

  const [individualName, setIndividualName] = useState("");
  const [individualLocation, setIndividualLocation] = useState("");
  const [individualPhone, setIndividualPhone] = useState("");
  const [showCompanyForm, setShowCompanyForm] = useState(false);
  const [showIndividualForm, setShowIndividualForm] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/");
        return;
      }
      setUserId(user.uid);
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        const data = snap.data() as { name?: string };
        setUserName(data.name ?? "");
      }
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    const loadPortals = async () => {
      if (!userId) return;
      const snapshot = await getDocs(
        query(
          collection(db, "vendorPortals"),
          where("memberIds", "array-contains", userId)
        )
      );
      const items: PortalSummary[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as {
          name?: string;
          type?: PortalType;
          location?: string;
          createdAt?: { toDate: () => Date };
        };
        const createdAt = data.createdAt?.toDate();
        items.push({
          id: docSnap.id,
          name: data.name || "Portal",
          type: data.type || "individual",
          location: data.location,
          createdAt: createdAt ? createdAt.toLocaleDateString() : undefined,
        });
      });
      setPortals(items);
    };
    loadPortals();
  }, [userId]);

  const openPortal = (portalId: string) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("activePortalId", portalId);
    }
    router.push(`/vendor?portalId=${portalId}`);
  };

  const createPortal = async (type: PortalType) => {
    if (!userId) return;
    setError(null);
    setLoading(true);
    try {
      if (type === "company") {
        if (!companyName || !companyLocation || !companyCertificate) {
          setError("Company name, location, and certificate are required.");
          setLoading(false);
          return;
        }
      } else {
        if (!individualName || !individualLocation) {
          setError("Portal name and location are required.");
          setLoading(false);
          return;
        }
      }

      let logoUrl = "";
      let certificateUrl = "";
      if (type === "company" && companyLogo) {
        const logoRef = ref(
          storage,
          `vendorPortals/${userId}/logos/${Date.now()}-${companyLogo.name}`
        );
        await uploadBytes(logoRef, companyLogo);
        logoUrl = await getDownloadURL(logoRef);
      }
      if (type === "company" && companyCertificate) {
        const certRef = ref(
          storage,
          `vendorPortals/${userId}/certificates/${Date.now()}-${companyCertificate.name}`
        );
        await uploadBytes(certRef, companyCertificate);
        certificateUrl = await getDownloadURL(certRef);
      }

      const portalName =
        type === "company" ? companyName : individualName;
      const location =
        type === "company" ? companyLocation : individualLocation;
      const phone = type === "company" ? companyPhone : individualPhone;

      const docRef = await addDoc(collection(db, "vendorPortals"), {
        name: portalName,
        type,
        location,
        phone,
        website: type === "company" ? companyWebsite : "",
        logoUrl,
        certificateUrl,
        createdBy: userId,
        admins: [userId],
        memberIds: [userId],
        members: {
          [userId]: {
            role: "admin",
            name: userName || portalName,
            email: auth.currentUser?.email ?? "",
            permissions: {
              admin: true,
              create_listings: true,
              add_sales: true,
              view_inquiries: true,
              view_leads: true,
              manage_members: true,
            },
          },
        },
        createdAt: serverTimestamp(),
      });
      openPortal(docRef.id);
    } catch {
      setError("Failed to create portal. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#f9f1e6,_#f2ede4_55%,_#efe7d8)] text-[#14110f]">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-[#a67047]">
              Portal setup
            </p>
            <h1 className="mt-2 font-serif text-2xl text-[#14110f]">
              Welcome{userName ? `, ${userName}` : ""}.
            </h1>
            <p className="mt-2 text-sm text-[#5a4a44]">
              Create or open a vendor portal.
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-[#eadfce] bg-white px-4 py-3 text-[11px] text-[#b3261e]">
            {error}
          </div>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-[#eadfce] bg-white p-5">
            <p className="text-xs uppercase tracking-[0.3em] text-[#a67047]">
              Your portals
            </p>
            <div className="mt-4 space-y-3">
              {portals.length === 0 ? (
                <p className="text-xs text-[#5a4a44]">
                  No portals yet. Create one below.
                </p>
              ) : (
                portals.map((portal) => (
                  <div
                    key={portal.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#eadfce] bg-[#fbf8f3] px-4 py-3 text-sm"
                  >
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-[#a67047]">
                        {portal.type === "company" ? "Company" : "Individual"}
                      </p>
                      <p className="mt-1 font-semibold text-[#14110f]">
                        {portal.name}
                      </p>
                      <p className="mt-1 text-[11px] text-[#5a4a44]">
                        {portal.location || "Location not set"} ·{" "}
                        {portal.createdAt ?? "Recently created"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openPortal(portal.id)}
                      className="rounded-full bg-[#1f3d2d] px-4 py-2 text-xs font-semibold text-white"
                    >
                      Open portal
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex flex-wrap gap-2 lg:hidden">
              <button
                type="button"
                onClick={() => {
                  setShowCompanyForm(true);
                  setShowIndividualForm(false);
                }}
                className="rounded-full border border-[#eadfce] bg-white px-4 py-2 text-xs font-semibold text-[#1f3d2d]"
              >
                Register company portal
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowIndividualForm(true);
                  setShowCompanyForm(false);
                }}
                className="rounded-full border border-[#eadfce] bg-white px-4 py-2 text-xs font-semibold text-[#1f3d2d]"
              >
                Register individual portal
              </button>
            </div>

            <div
              className={`rounded-3xl border border-[#eadfce] bg-white p-5 ${
                showCompanyForm ? "block" : "hidden"
              } lg:block`}
            >
              <p className="text-xs uppercase tracking-[0.3em] text-[#a67047]">
                Register company portal
              </p>
              <div className="mt-4 grid gap-3 text-sm">
                <input
                  type="text"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  placeholder="Company name"
                  className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                />
                <input
                  type="text"
                  value={companyLocation}
                  onChange={(event) => setCompanyLocation(event.target.value)}
                  placeholder="Location"
                  className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                />
                <input
                  type="tel"
                  value={companyPhone}
                  onChange={(event) => setCompanyPhone(event.target.value)}
                  placeholder="Phone (optional)"
                  className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                />
                <input
                  type="url"
                  value={companyWebsite}
                  onChange={(event) => setCompanyWebsite(event.target.value)}
                  placeholder="Website (optional)"
                  className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                />
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  onChange={(event) =>
                    setCompanyCertificate(event.target.files?.[0] ?? null)
                  }
                  className="text-xs text-[#5a4a44] file:mr-3 file:rounded-full file:border-0 file:bg-[#c77d4b] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
                />
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) =>
                    setCompanyLogo(event.target.files?.[0] ?? null)
                  }
                  className="text-xs text-[#5a4a44] file:mr-3 file:rounded-full file:border-0 file:bg-[#eadfce] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[#5a4a44]"
                />
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => createPortal("company")}
                  className="rounded-full bg-[#1f3d2d] px-4 py-2 text-xs font-semibold text-white"
                >
                  {loading ? "Creating..." : "Create company portal"}
                </button>
              </div>
            </div>

            <div
              className={`rounded-3xl border border-[#eadfce] bg-white p-5 ${
                showIndividualForm ? "block" : "hidden"
              } lg:block`}
            >
              <p className="text-xs uppercase tracking-[0.3em] text-[#a67047]">
                Register individual portal
              </p>
              <div className="mt-4 grid gap-3 text-sm">
                <input
                  type="text"
                  value={individualName}
                  onChange={(event) => setIndividualName(event.target.value)}
                  placeholder="Portal name"
                  className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                />
                <input
                  type="text"
                  value={individualLocation}
                  onChange={(event) => setIndividualLocation(event.target.value)}
                  placeholder="Location"
                  className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                />
                <input
                  type="tel"
                  value={individualPhone}
                  onChange={(event) => setIndividualPhone(event.target.value)}
                  placeholder="Phone (optional)"
                  className="w-full rounded-2xl border border-[#eadfce] bg-white px-3 py-2 text-sm text-[#14110f]"
                />
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => createPortal("individual")}
                  className="rounded-full bg-[#1f3d2d] px-4 py-2 text-xs font-semibold text-white"
                >
                  {loading ? "Creating..." : "Create individual portal"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
