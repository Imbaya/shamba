import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") || "").trim();
    if (!query) {
      return NextResponse.json({ results: [] });
    }

    const apiKey =
      process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GOOGLE_MAPS_API_KEY is not configured." },
        { status: 500 }
      );
    }

    const googleResponse = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
        query
      )}&key=${apiKey}`
    );
    if (!googleResponse.ok) {
      const text = await googleResponse.text();
      return NextResponse.json(
        { error: `Google geocode request failed: ${text}` },
        { status: 502 }
      );
    }

    const payload = (await googleResponse.json()) as {
      status?: string;
      results?: {
        place_id?: string;
        formatted_address?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
      }[];
    };

    if (payload.status && payload.status !== "OK" && payload.status !== "ZERO_RESULTS") {
      return NextResponse.json(
        { error: `Google geocode status: ${payload.status}` },
        { status: 502 }
      );
    }

    const results = (payload.results ?? [])
      .map((item) => {
        const lat = Number(item.geometry?.location?.lat);
        const lng = Number(item.geometry?.location?.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return {
          id: item.place_id || `${lat},${lng}`,
          place_name: item.formatted_address || "Location",
          center: [lng, lat] as [number, number],
        };
      })
      .filter(
        (
          item
        ): item is { id: string; place_name: string; center: [number, number] } =>
          item !== null
      )
      .slice(0, 5);

    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

