// One projection shared by the basemap build script and the map component,
// so streets baked into public/maps/detroit-basemap.svg and the service
// markers drawn at runtime always line up.
//
// Two stages:
// 1. Equirectangular, with the longitude scale corrected by cos(latitude)
//    so the street grid stays square. At a few kilometres this is visually
//    indistinguishable from Web Mercator.
// 2. A focus + context lens centred on downtown (Sarkar and Brown's
//    graphical fisheye). Eight of the twelve services sit within about a
//    kilometre of each other downtown; at true scale their markers would
//    overlap. The lens magnifies downtown and eases the outskirts inward,
//    the way transit maps do, while every street stays continuous and
//    markers stay on their real addresses relative to the streets.

export const VIEW_W = 1000;
export const VIEW_H = 700;

// Frames downtown, Midtown, and the riverfront, with the Detroit River along
// the bottom edge for orientation.
const CENTER_LON = -83.056;
const MIN_LAT = 42.31;
const MAX_LAT = 42.395;

const PX_PER_DEG_LAT = VIEW_H / (MAX_LAT - MIN_LAT);
const MID_LAT_RAD = (((MIN_LAT + MAX_LAT) / 2) * Math.PI) / 180;
const PX_PER_DEG_LON = PX_PER_DEG_LAT * Math.cos(MID_LAT_RAD);
const LON_SPAN = VIEW_W / PX_PER_DEG_LON;

export const BOUNDS = {
  minLat: MIN_LAT,
  maxLat: MAX_LAT,
  minLon: CENTER_LON - LON_SPAN / 2,
  maxLon: CENTER_LON + LON_SPAN / 2,
} as const;

function linear(lat: number, lon: number): { x: number; y: number } {
  return {
    x: (lon - BOUNDS.minLon) * PX_PER_DEG_LON,
    // Latitude increases northward; SVG y increases downward, so invert.
    y: (BOUNDS.maxLat - lat) * PX_PER_DEG_LAT,
  };
}

// Lens centre: Campus Martius, the middle of the downtown cluster.
export const FOCUS = linear(42.3326, -83.0505);
// Magnification at the centre is 1 + DISTORTION.
const DISTORTION = 2;
// Exactly the farthest corner, so every point in the frame is inside the
// lens and the mapping stays continuous across the whole map. The frame
// above is deliberately larger than the service footprint because the lens
// pushes the edges outward; these values were chosen so all twelve
// services land inside the frame with the most room between markers.
const LENS_RADIUS = Math.max(
  ...[
    [0, 0],
    [VIEW_W, 0],
    [0, VIEW_H],
    [VIEW_W, VIEW_H],
  ].map(([x, y]) => Math.hypot(x - FOCUS.x, y - FOCUS.y))
);

export function project(lat: number, lon: number): { x: number; y: number } {
  const p = linear(lat, lon);
  const dx = p.x - FOCUS.x;
  const dy = p.y - FOCUS.y;
  const r = Math.hypot(dx, dy);
  if (r === 0 || r >= LENS_RADIUS) return p;
  const t = r / LENS_RADIUS;
  const scaled = ((DISTORTION + 1) * t) / (DISTORTION * t + 1);
  const k = (scaled * LENS_RADIUS) / r;
  return { x: FOCUS.x + dx * k, y: FOCUS.y + dy * k };
}
