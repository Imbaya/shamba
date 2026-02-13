import { NextResponse } from "next/server";

export const runtime = "nodejs";

type OverlayPoint = { x: number; y: number };
type MutationParcel = {
  parcelNumber: number;
  confidence?: number;
  points: OverlayPoint[];
};

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

const normalizePoints = (points: OverlayPoint[]) =>
  points
    .map((point) => {
      const xRaw = Number(point.x);
      const yRaw = Number(point.y);
      if (!Number.isFinite(xRaw) || !Number.isFinite(yRaw)) return null;
      const x = xRaw > 1 ? xRaw : xRaw * 100;
      const y = yRaw > 1 ? yRaw : yRaw * 100;
      return {
        x: Math.max(0, Math.min(100, x)),
        y: Math.max(0, Math.min(100, y)),
      };
    })
    .filter((point): point is OverlayPoint => point !== null);

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
      mutationFormUrl?: string;
      expectedParcelCount?: number;
    };
    const mutationFormUrl = body.mutationFormUrl?.trim();
    const expectedParcelCount = Math.max(
      1,
      Math.trunc(Number(body.expectedParcelCount) || 1)
    );
    if (!mutationFormUrl) {
      return NextResponse.json(
        { error: "mutationFormUrl is required." },
        { status: 400 }
      );
    }

    const fileResponse = await fetch(mutationFormUrl);
    if (!fileResponse.ok) {
      return NextResponse.json(
        { error: "Could not fetch mutation form file." },
        { status: 400 }
      );
    }
    const mimeType =
      fileResponse.headers.get("content-type") ||
      (mutationFormUrl.toLowerCase().includes(".pdf")
        ? "application/pdf"
        : "image/jpeg");
    const bytes = new Uint8Array(await fileResponse.arrayBuffer());
    const base64 = Buffer.from(bytes).toString("base64");

    const prompt = [
      "You are extracting parcel polygons from a mutation/survey map.",
      "Find only parcels with clearly visible numeric labels.",
      `Expected parcel count is around ${expectedParcelCount}.`,
      "Ignore logos, legend boxes, side labels, headings, and decorative shapes.",
      "Return STRICT JSON only with shape:",
      '{"parcels":[{"parcelNumber":1,"confidence":0.92,"points":[{"x":0.15,"y":0.2},{"x":0.19,"y":0.2},{"x":0.19,"y":0.25},{"x":0.15,"y":0.25}]}]}',
      "Coordinates must be normalized in [0,1] over full image/page.",
      "Use 3+ polygon points.",
      "Return unique parcel numbers only.",
    ].join("\n");

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType,
                    data: base64,
                  },
                },
              ],
            },
          ],
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

    const geminiPayload = (await geminiResponse.json()) as {
      candidates?: {
        content?: { parts?: { text?: string }[] };
      }[];
    };
    const modelText =
      geminiPayload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("\n")
        .trim() ?? "";
    if (!modelText) return NextResponse.json({ parcels: [] });

    const parsed = JSON.parse(extractJson(modelText)) as {
      parcels?: MutationParcel[];
    };
    const seen = new Set<number>();
    const parcels = (parsed.parcels ?? [])
      .map((parcel) => ({
        parcelNumber: Math.trunc(Number(parcel.parcelNumber)),
        confidence:
          typeof parcel.confidence === "number" ? parcel.confidence : undefined,
        points: normalizePoints(parcel.points ?? []),
      }))
      .filter((parcel) => parcel.parcelNumber > 0 && parcel.points.length >= 3)
      .filter((parcel) => {
        if (seen.has(parcel.parcelNumber)) return false;
        seen.add(parcel.parcelNumber);
        return true;
      })
      .sort((a, b) => a.parcelNumber - b.parcelNumber);

    return NextResponse.json({ parcels });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
