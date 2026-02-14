type LatLngLiteral = { lat: number; lng: number };

export type MapsEventListener = { remove: () => void };

export interface MapsPath {
  getLength: () => number;
  getAt: (index: number) => { lat: () => number; lng: () => number };
}

export interface MapsPolygon {
  getPath: () => MapsPath;
  setMap: (map: MapsMap | null) => void;
}

export interface MapsMarker {
  setMap: (map: MapsMap | null) => void;
  setPosition: (position: LatLngLiteral) => void;
}

export interface AdvancedMarkerElementLike {
  map: MapsMap | null;
}

export interface MapsLatLngBounds {
  extend: (point: LatLngLiteral) => void;
}

export interface MapsMap {
  fitBounds: (bounds: MapsLatLngBounds, padding?: number) => void;
  setCenter: (point: LatLngLiteral) => void;
  setZoom: (zoom: number) => void;
  setMapTypeId?: (type: string) => void;
  setTilt?: (tilt: number) => void;
  setHeading?: (heading: number) => void;
  moveCamera?: (options: {
    center?: LatLngLiteral;
    zoom?: number;
    tilt?: number;
    heading?: number;
  }) => void;
}

type MapOptions = {
  center: LatLngLiteral;
  zoom: number;
  mapId?: string;
  mapTypeId?: string;
  tilt?: number;
  heading?: number;
  mapTypeControl?: boolean;
  streetViewControl?: boolean;
  fullscreenControl?: boolean;
  zoomControl?: boolean;
  gestureHandling?: string;
  scrollwheel?: boolean;
  styles?: unknown[];
  disableDefaultUI?: boolean;
};

type MarkerOptions = {
  map?: MapsMap;
  position: LatLngLiteral;
  title?: string;
  label?:
    | string
    | {
        text: string;
        color?: string;
        fontSize?: string;
        fontWeight?: string;
      };
  icon?: unknown;
};

type PolygonOptions = {
  map?: MapsMap;
  paths: LatLngLiteral[];
  strokeColor?: string;
  strokeOpacity?: number;
  strokeWeight?: number;
  fillColor?: string;
  fillOpacity?: number;
  draggable?: boolean;
  clickable?: boolean;
};

type DirectionsRequest = {
  origin: LatLngLiteral;
  destination: LatLngLiteral;
  travelMode: string;
};

type DirectionsLeg = {
  distance?: { text?: string };
  duration?: { text?: string };
};

type DirectionsResult = {
  routes?: { legs?: DirectionsLeg[] }[];
};

type DirectionsRendererOptions = {
  map?: MapsMap;
  suppressMarkers?: boolean;
  polylineOptions?: {
    strokeColor?: string;
    strokeOpacity?: number;
    strokeWeight?: number;
  };
};

type PlacesSearchRequest = {
  location: { lat: number; lng: number };
  radius: number;
  keyword?: string;
};

type PlaceResult = {
  name?: string;
  vicinity?: string;
  geometry?: {
    location?: {
      lat: () => number;
      lng: () => number;
    };
  };
};

type PlacesServiceStatus = string;

export interface MapsPlacesService {
  nearbySearch: (
    request: PlacesSearchRequest,
    callback: (
      results: PlaceResult[] | null,
      status: PlacesServiceStatus
    ) => void
  ) => void;
}

export interface MapsDirectionsService {
  route: (request: DirectionsRequest) => Promise<DirectionsResult>;
}

export interface MapsDirectionsRenderer {
  setMap: (map: MapsMap | null) => void;
  setDirections: (result: DirectionsResult) => void;
}

export interface GoogleMapsApi {
  Map: new (element: HTMLElement, options: MapOptions) => MapsMap;
  Marker: new (options: MarkerOptions) => MapsMarker;
  Polygon: new (options: PolygonOptions) => MapsPolygon;
  DirectionsService?: new () => MapsDirectionsService;
  DirectionsRenderer?: new (options?: DirectionsRendererOptions) => MapsDirectionsRenderer;
  TravelMode?: {
    DRIVING: string;
  };
  places?: {
    PlacesService: new (attrContainer: HTMLElement | MapsMap) => MapsPlacesService;
    PlacesServiceStatus?: {
      OK: string;
    };
  };
  LatLngBounds: new () => MapsLatLngBounds;
  Size: new (width: number, height: number) => unknown;
  SymbolPath: {
    CIRCLE: unknown;
  };
  event: {
    addListener: (
      instance: unknown,
      eventName: string,
      handler: (...args: unknown[]) => void
    ) => MapsEventListener;
    clearInstanceListeners: (instance: unknown) => void;
  };
  marker?: {
    AdvancedMarkerElement: new (options: {
      map?: MapsMap;
      position: LatLngLiteral;
      content?: Node;
      title?: string;
      gmpClickable?: boolean;
    }) => AdvancedMarkerElementLike;
  };
}

type GoogleWindow = Window & {
  google?: {
    maps?: GoogleMapsApi;
  };
};

let loadingPromise: Promise<GoogleMapsApi> | null = null;

export async function loadGoogleMapsApi(): Promise<GoogleMapsApi> {
  if (typeof window === "undefined") {
    throw new Error("Google Maps is only available in the browser.");
  }

  const existing = (window as GoogleWindow).google?.maps;
  if (existing) {
    return existing;
  }

  if (loadingPromise) {
    return loadingPromise;
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not configured.");
  }

  loadingPromise = new Promise((resolve, reject) => {
    const scriptId = "google-maps-js-sdk";
    const existingScript = document.getElementById(scriptId) as
      | HTMLScriptElement
      | null;

    const handleLoad = () => {
      const maps = (window as GoogleWindow).google?.maps;
      if (!maps) {
        reject(new Error("Google Maps loaded but API is unavailable."));
        return;
      }
      resolve(maps);
    };

    if (existingScript) {
      existingScript.addEventListener("load", handleLoad, { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Failed to load Google Maps script.")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey
    )}&v=weekly&libraries=marker,places`;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Failed to load Google Maps script.")),
      { once: true }
    );
    document.head.appendChild(script);
  });

  return loadingPromise;
}
