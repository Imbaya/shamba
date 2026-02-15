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

type CopilotTab =
  | "active"
  | "drafts"
  | "inquiries"
  | "leads"
  | "visits"
  | "pending"
  | "sales"
  | "members";

const VALID_TABS: CopilotTab[] = [
  "active",
  "drafts",
  "inquiries",
  "leads",
  "visits",
  "pending",
  "sales",
  "members",
];

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
      activeTab?: CopilotTab;
      summary?: Record<string, unknown>;
      hotLeads?: {
        id?: string;
        buyer?: string;
        parcel?: string;
        status?: string;
        assignedAgentName?: string | null;
        nextFollowUpAt?: string | null;
      }[];
    };

    const prompt = [
      "You are an operations copilot for a land-sales vendor team dashboard.",
      "Generate practical, short actions that help the team respond faster and close more deals.",
      "Currency context: all amounts are Kenya Shillings (KES), shown as Ksh.",
      "Never use placeholder names like Unknown or Unassigned. Use 'unattributed records' instead.",
      "Prioritize SLA queues, overdue follow-ups, and overdue collections.",
      "Return STRICT JSON only with shape:",
      '{"focus":"...", "actions":[{"title":"...", "reason":"...", "ctaTab":"leads", "ctaEntityId":"lead_123"}], "risks":["..."], "coachTip":"..."}',
      "Rules:",
      "- Keep focus and coachTip under 20 words.",
      "- Return 2-5 actions.",
      "- ctaTab must be one of: active, drafts, inquiries, leads, visits, pending, sales, members.",
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
        focus: "Clear overdue queues and keep response times under SLA.",
        actions: [
          {
            title: "Start with overdue follow-ups",
            reason: "These leads are most at risk of churn.",
            ctaTab: "leads",
          },
          {
            title: "Respond to all new inquiries",
            reason: "Fast first contact raises conversion odds.",
            ctaTab: "inquiries",
          },
        ],
        risks: ["No model output returned."],
        coachTip: "Run this copilot each morning and after lunch.",
      });
    }

    const parsed = JSON.parse(extractJson(modelText)) as {
      focus?: string;
      actions?: {
        title?: string;
        reason?: string;
        ctaTab?: string;
        ctaEntityId?: string;
      }[];
      risks?: string[];
      coachTip?: string;
    };

    const normalizedActions = (parsed.actions ?? [])
      .map((action) => {
        const ctaTab = VALID_TABS.includes(action.ctaTab as CopilotTab)
          ? (action.ctaTab as CopilotTab)
          : undefined;
        return {
          title: (action.title || "").replace(/unknown|unassigned/gi, "unattributed"),
          reason: (action.reason || "").replace(/unknown|unassigned/gi, "unattributed"),
          ...(ctaTab ? { ctaTab } : {}),
          ...(action.ctaEntityId?.trim() ? { ctaEntityId: action.ctaEntityId.trim() } : {}),
        };
      })
      .filter((action) => action.title.trim().length > 0 && action.reason.trim().length > 0)
      .slice(0, 5);

    return NextResponse.json({
      focus:
        (parsed.focus?.trim() || "Clear SLA backlog and protect close-rate this week.").replace(
          /unknown|unassigned/gi,
          "unattributed"
        ),
      actions: normalizedActions,
      risks: (parsed.risks ?? [])
        .map((item) => `${item}`.replace(/unknown|unassigned/gi, "unattributed"))
        .filter((item) => item.trim().length > 0)
        .slice(0, 4),
      coachTip:
        (parsed.coachTip?.trim() || "Prioritize speed-to-first-response before deep qualification.").replace(
          /unknown|unassigned/gi,
          "unattributed"
        ),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
