import { NextResponse } from "next/server";

export const runtime = "nodejs";

type OverlayPoint = { x: number; y: number };
type ParcelOverlay = {
  parcelNumber: number;
  confidence?: number;
  points: OverlayPoint[];
};
type SurveyBounds = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
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
  if (first >= 0 && last > first) {
    return stripped.slice(first, last + 1);
  }
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

const normalizeBounds = (bounds?: Partial<SurveyBounds> | null) => {
  if (!bounds) return null;
  const xMinRaw = Number(bounds.xMin);
  const yMinRaw = Number(bounds.yMin);
  const xMaxRaw = Number(bounds.xMax);
  const yMaxRaw = Number(bounds.yMax);
  if (
    !Number.isFinite(xMinRaw) ||
    !Number.isFinite(yMinRaw) ||
    !Number.isFinite(xMaxRaw) ||
    !Number.isFinite(yMaxRaw)
  ) {
    return null;
  }
  const toPct = (value: number) => (value > 1 ? value : value * 100);
  const xMin = Math.max(0, Math.min(100, toPct(xMinRaw)));
  const yMin = Math.max(0, Math.min(100, toPct(yMinRaw)));
  const xMax = Math.max(0, Math.min(100, toPct(xMaxRaw)));
  const yMax = Math.max(0, Math.min(100, toPct(yMaxRaw)));
  if (xMax <= xMin || yMax <= yMin) return null;
  return { xMin, yMin, xMax, yMax };
};

const pointInBounds = (point: OverlayPoint, bounds: SurveyBounds) =>
  point.x >= bounds.xMin &&
  point.x <= bounds.xMax &&
  point.y >= bounds.yMin &&
  point.y <= bounds.yMax;

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
      soldParcelIds?: number[];
    };
    const mutationFormUrl = body.mutationFormUrl?.trim();
    const soldParcelIds = Array.from(
      new Set(
        (body.soldParcelIds ?? [])
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0)
          .map((id) => Math.trunc(id))
      )
    );
    if (!mutationFormUrl) {
      return NextResponse.json(
        { error: "mutationFormUrl is required." },
        { status: 400 }
      );
    }
    if (!soldParcelIds.length) {
      return NextResponse.json({ overlays: [] });
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
      "You are identifying sold parcels on a mutation/survey map.",
      `Target sold parcel numbers: ${soldParcelIds.join(", ")}.`,
      "CRITICAL MATCH RULE: parcel number matching must be exact.",
      "Example: if target includes 1, match only label '1' or 'Parcel 1'.",
      "Do NOT match 1 to 10, 11, 21, 101, 104, or any other number.",
      "If an exact target label is not visible, omit it.",
      "First detect the overall parcel-grid region (the rectangular block containing parcel cells).",
      "Then detect only target parcel polygons INSIDE that parcel-grid region.",
      "Never return legend boxes, logos, side labels, text boxes, or decorative shapes outside the parcel grid.",
      "Return STRICT JSON only with shape:",
      '{"surveyBounds":{"xMin":0.2,"yMin":0.18,"xMax":0.72,"yMax":0.92},"overlays":[{"parcelNumber":104,"confidence":0.91,"points":[{"x":0.12,"y":0.3},{"x":0.2,"y":0.33},{"x":0.19,"y":0.4}]}]}',
      "Use 3+ polygon points per parcel.",
      "Coordinates must be normalized in [0,1] over the full page/image.",
      "Return confidence for each parcel in [0,1].",
      "Only include requested sold parcels with confidence >= 0.70.",
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
    if (!modelText) {
      return NextResponse.json({ overlays: [] });
    }

    const parsed = JSON.parse(extractJson(modelText)) as {
      surveyBounds?: Partial<SurveyBounds>;
      overlays?: ParcelOverlay[];
    };
    const surveyBounds = normalizeBounds(parsed.surveyBounds);
    const overlays = (parsed.overlays ?? [])
      .map((overlay) => ({
        parcelNumber: Math.trunc(Number(overlay.parcelNumber)),
        confidence: Number(overlay.confidence),
        points: normalizePoints(overlay.points ?? []),
      }))
      .filter(
        (overlay) =>
          soldParcelIds.includes(overlay.parcelNumber) &&
          overlay.points.length >= 3 &&
          Number.isFinite(overlay.confidence) &&
          overlay.confidence >= 0.7 &&
          (!surveyBounds ||
            overlay.points.filter((point) => pointInBounds(point, surveyBounds))
              .length /
              overlay.points.length >=
              0.8)
      );

    return NextResponse.json({ overlays });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
