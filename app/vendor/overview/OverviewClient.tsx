"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { auth, db } from "../../../lib/firebase";

type OverviewPayload = {
  headline: string;
  strengths: string[];
  risks: string[];
  recommendedActions: string[];
  agentHighlights: string[];
};

const normalizeAgentLabel = (value: unknown) => {
  const raw = `${value ?? ""}`.trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower === "unknown" || lower === "unassigned" || lower === "n/a") {
    return "";
  }
  return raw;
};

export default function OverviewClient() {
  const searchParams = useSearchParams();
  const [portalId, setPortalId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [portalName, setPortalName] = useState("Portal");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<OverviewPayload | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const idFromUrl = searchParams.get("portalId");
    const idFromStorage = window.localStorage.getItem("activePortalId");
    setPortalId(idFromUrl || idFromStorage || null);
  }, [searchParams]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUserId(user?.uid ?? null);
    });
    return () => unsubscribe();
  }, []);

  const loadOverview = async () => {
    if (!portalId || !userId) return;
    setLoading(true);
    setError(null);
    try {
      const portalSnap = await getDoc(doc(db, "vendorPortals", portalId));
      if (!portalSnap.exists()) {
        setError("Portal not found.");
        setLoading(false);
        return;
      }
      const portal = portalSnap.data() as {
        name?: string;
        members?: Record<string, { role?: string; name?: string; email?: string }>;
      };
      setPortalName(portal.name || "Portal");
      const member = portal.members?.[userId];
      const admin = member?.role === "admin";
      setIsAdmin(admin);
      if (!admin) {
        setError("Access denied. Admin only.");
        setLoading(false);
        return;
      }

      const memberNameById = new Map(
        Object.entries(portal.members ?? {}).map(([id, member]) => [
          id,
          normalizeAgentLabel(member?.name) ||
            normalizeAgentLabel(member?.email) ||
            "Unattributed",
        ])
      );

      const [inquiriesSnap, salesSnap, pendingSnap] = await Promise.all([
        getDocs(query(collection(db, "inquiries"), where("portalId", "==", portalId))),
        getDocs(query(collection(db, "sales"), where("portalId", "==", portalId))),
        getDocs(query(collection(db, "pendingSales"), where("portalId", "==", portalId))),
      ]);

      const inquiries = inquiriesSnap.docs.map((snap) => snap.data() as Record<string, unknown>);
      const sales = salesSnap.docs.map((snap) => snap.data() as Record<string, unknown>);
      const pending = pendingSnap.docs.map((snap) => snap.data() as Record<string, unknown>);

      const byAgent = new Map<string, { salesValue: number; won: number; responded: number }>();
      inquiries.forEach((inquiry) => {
        const assignedId = `${inquiry.assignedAgentId ?? ""}`.trim();
        const fromId = assignedId ? memberNameById.get(assignedId) : "";
        const fromInquiry = normalizeAgentLabel(inquiry.assignedAgentName);
        const agent = fromId || fromInquiry || "Unattributed";
        const status = `${inquiry.status ?? "new"}`;
        const entry = byAgent.get(agent) ?? { salesValue: 0, won: 0, responded: 0 };
        if (status === "responded" || status === "successful") entry.responded += 1;
        if (status === "successful") entry.won += 1;
        byAgent.set(agent, entry);
      });
      sales.forEach((sale) => {
        const createdById = `${sale.createdByAgentId ?? ""}`.trim();
        const fromId = createdById ? memberNameById.get(createdById) : "";
        const fromSale = normalizeAgentLabel(sale.createdByAgentName);
        const agent = fromId || fromSale || "Unattributed";
        const value = Number(sale.salePrice ?? 0);
        const entry = byAgent.get(agent) ?? { salesValue: 0, won: 0, responded: 0 };
        entry.salesValue += Number.isFinite(value) ? value : 0;
        byAgent.set(agent, entry);
      });

      const topAgents = Array.from(byAgent.entries())
        .map(([name, values]) => ({
          name,
          salesValue: values.salesValue,
          winRate:
            values.responded > 0
              ? Math.round((values.won / values.responded) * 100)
              : 0,
        }))
        .sort((a, b) => b.salesValue - a.salesValue)
        .slice(0, 5);

      const recentLeadSignals = inquiries
        .slice(0, 6)
        .map((inquiry) => ({
          buyer: `${inquiry.buyerName ?? "Buyer"}`,
          note: `${inquiry.message ?? "No note"}`.slice(0, 120),
          status: `${inquiry.status ?? "new"}`,
        }));

      const summary = {
        totalInquiries: inquiries.length,
        openInquiries: inquiries.filter((item) => `${item.status ?? "new"}` === "new").length,
        respondedLeads: inquiries.filter((item) => `${item.status ?? "new"}` === "responded").length,
        successfulLeads: inquiries.filter((item) => `${item.status ?? "new"}` === "successful").length,
        totalSalesValue: sales.reduce((sum, item) => sum + Number(item.salePrice ?? 0), 0),
        pendingSalesValue: pending.reduce((sum, item) => sum + Number(item.salePrice ?? 0), 0),
      };

      const aiResponse = await fetch("/api/gemini/vendor-overview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portalName: portal.name || "Portal",
          summary,
          topAgents,
          recentLeadSignals,
        }),
      });
      if (!aiResponse.ok) {
        const text = await aiResponse.text();
        throw new Error(text || "Failed to generate overview.");
      }
      const aiPayload = (await aiResponse.json()) as OverviewPayload;
      setOverview(aiPayload);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load overview.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portalId, userId]);

  const sections = useMemo(
    () => [
      { title: "Strengths", items: overview?.strengths ?? [] },
      { title: "Risks", items: overview?.risks ?? [] },
      { title: "Recommended Actions", items: overview?.recommendedActions ?? [] },
      { title: "Agent Highlights", items: overview?.agentHighlights ?? [] },
    ],
    [overview]
  );

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#f9f1e6,_#f2ede4_55%,_#efe7d8)] px-4 py-8 text-[#14110f] sm:px-6">
      <div className="mx-auto max-w-4xl rounded-3xl border border-[#eadfce] bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[#a67047]">Overview</p>
            <h1 className="mt-2 font-serif text-2xl">{portalName}</h1>
          </div>
          <button
            type="button"
            onClick={loadOverview}
            className="rounded-full border border-[#1f3d2d]/30 px-4 py-2 text-xs font-semibold text-[#1f3d2d]"
          >
            Refresh
          </button>
        </div>

        {loading && <p className="mt-6 text-sm text-[#5a4a44]">Generating overview...</p>}
        {!loading && error && <p className="mt-6 text-sm text-[#b3261e]">{error}</p>}
        {!loading && !error && overview && (
          <div className="mt-6 space-y-4">
            <div className="rounded-2xl border border-[#eadfce] bg-[#fbf8f3] px-4 py-3">
              <p className="text-sm font-semibold">{overview.headline}</p>
            </div>
            {sections.map((section) => (
              <div key={section.title} className="rounded-2xl border border-[#eadfce] bg-[#fbf8f3] px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.25em] text-[#a67047]">{section.title}</p>
                <ul className="mt-2 space-y-1 text-sm text-[#5a4a44]">
                  {section.items.length > 0 ? (
                    section.items.map((item, index) => <li key={`${section.title}-${index}`}>- {item}</li>)
                  ) : (
                    <li>- No items.</li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}

        {!isAdmin && !loading && (
          <p className="mt-6 text-sm text-[#7a5f54]">This page is restricted to admins.</p>
        )}
      </div>
    </main>
  );
}
