import { NextResponse } from "next/server";

export const runtime = "nodejs";

const stripCodeFences = (value: string) =>
  value
    .trim()
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/, "")
    .trim();

const extractJson = (value: string) => {
  const stripped = stripCodeFences(value);
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first >= 0 && last > first) return stripped.slice(first, last + 1);
  return stripped;
};

export async function POST(request: Request) {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured." },
        { status: 500 }
      );
    }

    const body = (await request.json()) as {
      portalName?: string;
      summary?: {
        totalInquiries?: number;
        openInquiries?: number;
        respondedLeads?: number;
        successfulLeads?: number;
        totalSalesValue?: number;
        pendingSalesValue?: number;
      };
      topAgents?: { name: string; salesValue: number; winRate: number }[];
      recentLeadSignals?: { buyer: string; note: string; status: string }[];
    };

    const prompt = [
      "You are a vendor operations analyst.",
      "Create a concise management overview based on the provided dashboard data.",
      "Currency context: all monetary values are in Kenya Shillings (KES), displayed as Ksh.",
      "When referencing money, always use Ksh.",
      "Do not mention placeholder agent names like 'Unknown' or 'Unassigned'.",
      "If attribution is missing, refer to it as 'unattributed records'.",
      "Return STRICT JSON only with shape:",
      '{"headline":"...","strengths":["..."],"risks":["..."],"recommendedActions":["..."],"agentHighlights":["..."]}',
      "Keep each bullet short and practical.",
      `Input JSON: ${JSON.stringify(body)}`,
    ].join("\n");

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    if (!geminiResponse.ok) {
      const text = await geminiResponse.text();
      return NextResponse.json(
        { error: `Gemini request failed: ${text}` },
        { status: 502 }
      );
    }

    const payload = (await geminiResponse.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const modelText =
      payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("\n")
        .trim() ?? "";
    if (!modelText) {
      return NextResponse.json({
        headline: "No overview generated yet.",
        strengths: [],
        risks: [],
        recommendedActions: [],
        agentHighlights: [],
      });
    }

    const parsed = JSON.parse(extractJson(modelText)) as {
      headline?: string;
      strengths?: string[];
      risks?: string[];
      recommendedActions?: string[];
      agentHighlights?: string[];
    };

    return NextResponse.json({
      headline:
        (parsed.headline?.trim() || "Vendor overview").replace(
          /unknown|unassigned/gi,
          "unattributed"
        ),
      strengths: (parsed.strengths ?? [])
        .map((item) => `${item}`.replace(/unknown|unassigned/gi, "unattributed"))
        .slice(0, 5),
      risks: (parsed.risks ?? [])
        .map((item) => `${item}`.replace(/unknown|unassigned/gi, "unattributed"))
        .slice(0, 5),
      recommendedActions: (parsed.recommendedActions ?? [])
        .map((item) => `${item}`.replace(/unknown|unassigned/gi, "unattributed"))
        .slice(0, 6),
      agentHighlights: (parsed.agentHighlights ?? [])
        .map((item) => `${item}`.replace(/unknown|unassigned/gi, "unattributed"))
        .slice(0, 5),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
