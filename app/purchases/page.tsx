"use client";

export default function PurchasesPage() {
  return (
    <div className="min-h-screen bg-[#f7f3ea] px-4 py-10 text-[#14110f]">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 rounded-3xl border border-[#eadfce] bg-white p-6 shadow-[0_20px_60px_-40px_rgba(20,17,15,0.4)]">
        <p className="text-xs uppercase tracking-[0.35em] text-[#a67047]">
          Manage purchases
        </p>
        <h1 className="font-serif text-2xl">Coming soon</h1>
        <p className="text-sm text-[#5a4a44]">
          This page will host the purchase management workflow.
        </p>
        <button
          type="button"
          onClick={() => {
            window.location.href = "/vendor";
          }}
          className="w-fit rounded-full border border-[#eadfce] px-4 py-2 text-xs text-[#5a4a44]"
        >
          Back to vendor portal
        </button>
      </div>
    </div>
  );
}
