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
      lead?: {
        id?: string;
        buyer?: string;
        parcel?: string;
        phone?: string;
        status?: string;
        assignedAgentName?: string;
        respondedByName?: string;
        progressLogs?: { note?: string; at?: string; kind?: string }[];
        message?: string;
      };
    };

    if (!body.lead) {
      return NextResponse.json({ error: "lead is required." }, { status: 400 });
    }

    const lead = body.lead;
    const prompt = [
      "You are a real estate sales assistant.",
      "Given the lead data, propose concise next actions and two short outreach texts.",
      "Currency context: all prices and budgets are in Kenya Shillings (KES), displayed as Ksh.",
      "If you mention money, always use Ksh.",
      "Keep advice practical, no legal claims, no promises.",
      "Return STRICT JSON only with shape:",
      '{"nextSteps":["...","...","..."],"messageSuggestions":["...","..."],"riskLevel":"low","rationale":"..."}',
      "riskLevel must be one of: low, medium, high.",
      `Lead JSON: ${JSON.stringify(lead)}`,
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
        nextSteps: ["Follow up and confirm customer availability for a call."],
        messageSuggestions: [
          "Hi, just checking in on your interest. Would tomorrow at 10am work for a quick update call?",
        ],
        riskLevel: "medium",
        rationale: "No model output was returned.",
      });
    }

    const parsed = JSON.parse(extractJson(modelText)) as {
      nextSteps?: string[];
      messageSuggestions?: string[];
      riskLevel?: "low" | "medium" | "high";
      rationale?: string;
    };

    return NextResponse.json({
      nextSteps: (parsed.nextSteps ?? [])
        .map((item) => `${item}`.trim())
        .filter((item) => item.length > 0)
        .slice(0, 4),
      messageSuggestions: (parsed.messageSuggestions ?? [])
        .map((item) => `${item}`.trim())
        .filter((item) => item.length > 0)
        .slice(0, 3),
      riskLevel:
        parsed.riskLevel === "low" ||
        parsed.riskLevel === "medium" ||
        parsed.riskLevel === "high"
          ? parsed.riskLevel
          : "medium",
      rationale:
        parsed.rationale?.trim() ||
        "Based on lead status and recent interactions.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
