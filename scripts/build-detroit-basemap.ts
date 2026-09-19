// Builds apps/web/public/maps/detroit-basemap.svg from OpenStreetMap data.
//
// Why a pre-built SVG instead of map tiles: two tile providers (CARTO, then
// OpenFreeMap) both served fine from a server check yet rendered blank in a
// presenter's browser, which blocks third-party map CDNs. A basemap baked
// at build time is served from this app's own origin, so the map needs no
// external request at runtime and looks identical on any network.
//
// Run:  pnpm map:build            (uses the cached download if present)
//       pnpm map:build --refresh  (re-downloads from the Overpass API)
//
// Map data (c) OpenStreetMap contributors, ODbL. The UI shows attribution.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { BOUNDS, VIEW_H, VIEW_W, project } from '../apps/web/lib/map-projection';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'data/detroit/geo/.osm-cache.json');
const OUT = join(ROOT, 'apps/web/public/maps/detroit-basemap.svg');

// Small pad so roads run off the edge of the frame instead of stopping short.
const PAD = 0.002;
const BBOX = `${BOUNDS.minLat - PAD},${BOUNDS.minLon - PAD},${BOUNDS.maxLat + PAD},${BOUNDS.maxLon + PAD}`;

const QUERY = `[out:json][timeout:120];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|tertiary|residential|unclassified|living_street)$"](${BBOX});
  way["natural"="water"](${BBOX});
  relation["natural"="water"](${BBOX});
  way["leisure"="park"](${BBOX});
);
out geom;`;

interface LatLon {
  lat: number;
  lon: number;
}
interface OsmWay {
  type: 'way';
  id: number;
  tags: Record<string, string>;
  geometry: LatLon[];
}
interface OsmRelation {
  type: 'relation';
  id: number;
  tags: Record<string, string>;
  members: Array<{ type: string; role: string; geometry?: LatLon[] }>;
}
type Pt = [number, number];

async function loadOsm(): Promise<Array<OsmWay | OsmRelation>> {
  if (existsSync(CACHE) && !process.argv.includes('--refresh')) {
    return JSON.parse(readFileSync(CACHE, 'utf8')).elements;
  }
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': 'detroit-cyber-ready-basemap/1.0 (build script)',
    },
    body: `data=${encodeURIComponent(QUERY)}`,
  });
  if (!res.ok) throw new Error(`Overpass returned ${res.status}`);
  const text = await res.text();
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, text);
  return JSON.parse(text).elements;
}

// The lens bends straight lines, so long OSM segments are split into short
// steps before projecting; otherwise a two-node avenue would cut straight
// across the curve its cross streets follow.
const STEP_DEG = 0.00025;
function densify(g: LatLon[]): LatLon[] {
  const out: LatLon[] = [];
  for (let i = 0; i < g.length; i++) {
    out.push(g[i]);
    if (i === g.length - 1) break;
    const a = g[i];
    const b = g[i + 1];
    const n = Math.floor(Math.hypot(b.lat - a.lat, b.lon - a.lon) / STEP_DEG);
    for (let k = 1; k < n; k++) out.push({ lat: a.lat + ((b.lat - a.lat) * k) / n, lon: a.lon + ((b.lon - a.lon) * k) / n });
  }
  return out;
}

const toPts = (g: LatLon[]): Pt[] => densify(g).map((p) => {
  const { x, y } = project(p.lat, p.lon);
  return [x, y];
});

function perpDist(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

// Douglas-Peucker: drops points that change the drawn line by less than
// `tol` pixels, which is most of them on a street grid.
function simplify(pts: Pt[], tol = 0.6): Pt[] {
  if (pts.length < 3) return pts;
  let max = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= tol) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)];
}

const MARGIN = 40;
const inFrame = (pts: Pt[]) =>
  pts.some(([x, y]) => x > -MARGIN && x < VIEW_W + MARGIN && y > -MARGIN && y < VIEW_H + MARGIN);

const fmt = (n: number) => String(Math.round(n * 10) / 10);
const pathOf = (pts: Pt[], close = false) =>
  `M${pts.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join(' ')}${close ? 'Z' : ''}`;

// Relation members arrive as separate ways; join them end to end into
// closed rings so the river can be filled.
function stitchRings(ways: Pt[][]): Pt[][] {
  const pool = ways.filter((w) => w.length > 1).map((w) => [...w]);
  const rings: Pt[][] = [];
  const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;
  while (pool.length) {
    let ring = pool.shift()!;
    let grew = true;
    while (grew && !same(ring[0], ring[ring.length - 1])) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i];
        const end = ring[ring.length - 1];
        if (same(end, w[0])) ring = [...ring, ...w.slice(1)];
        else if (same(end, w[w.length - 1])) ring = [...ring, ...[...w].reverse().slice(1)];
        else if (same(ring[0], w[w.length - 1])) ring = [...w.slice(0, -1), ...ring];
        else if (same(ring[0], w[0])) ring = [...[...w].reverse().slice(0, -1), ...ring];
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    rings.push(ring);
  }
  return rings;
}

const ROAD_TIERS: Array<{ id: string; kinds: string[]; stroke: string; width: number }> = [
  { id: 'local', kinds: ['residential', 'unclassified', 'living_street'], stroke: 'rgb(233 229 220 / 0.075)', width: 0.9 },
  { id: 'tertiary', kinds: ['tertiary'], stroke: 'rgb(233 229 220 / 0.12)', width: 1.2 },
  { id: 'secondary', kinds: ['secondary', 'primary_link', 'trunk_link'], stroke: 'rgb(233 229 220 / 0.17)', width: 1.6 },
  { id: 'primary', kinds: ['primary', 'trunk'], stroke: 'rgb(233 229 220 / 0.2)', width: 2.2 },
  { id: 'motorway', kinds: ['motorway', 'motorway_link'], stroke: 'rgb(233 229 220 / 0.24)', width: 3 },
];

// Roads worth naming for orientation. Freeways by their signed number,
// avenues by the name a Detroiter would use.
const ROAD_LABELS: Array<{ label: string; ref?: string; name?: string }> = [
  { label: 'I-75', ref: 'I 75' },
  { label: 'I-375', ref: 'I 375' },
  { label: 'I-94', ref: 'I 94' },
  { label: 'Lodge Fwy', ref: 'M 10' },
  { label: 'Woodward Ave', name: 'Woodward Avenue' },
  { label: 'Michigan Ave', name: 'Michigan Avenue' },
  { label: 'Grand River Ave', name: 'Grand River Avenue' },
  { label: 'Gratiot Ave', name: 'Gratiot Avenue' },
  { label: 'Jefferson Ave', name: 'East Jefferson Avenue' },
];

const AREA_LABELS: Array<{ label: string; lat: number; lon: number; angle?: number; water?: boolean }> = [
  { label: 'Downtown', lat: 42.3352, lon: -83.0495 },
  { label: 'Midtown', lat: 42.3535, lon: -83.0612 },
  { label: 'Corktown', lat: 42.3335, lon: -83.0815 },
  { label: 'Eastern Market', lat: 42.3478, lon: -83.0405 },
  { label: 'Detroit River', lat: 42.3265, lon: -83.03, angle: -32, water: true },
];

function loadServicePoints(): Pt[] {
  const services = parse(readFileSync(join(ROOT, 'data/detroit/services.yaml'), 'utf8')) as Array<{ lat: number; lon: number }>;
  const list = Array.isArray(services) ? services : (services as { services: Array<{ lat: number; lon: number }> }).services;
  return list.map((s) => {
    const { x, y } = project(s.lat, s.lon);
    return [x, y];
  });
}

// Longest straight stretch of the named road that stays clear of the frame
// edges and of every service marker, so a label never sits on a marker.
function placeRoadLabel(lines: Pt[][], label: string, avoid: Pt[]) {
  const needed = label.length * 7.2 + 16;
  let best: { x: number; y: number; angle: number; len: number } | null = null;
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const [a, b] = [line[i], line[i + 1]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < needed) continue;
      const x = (a[0] + b[0]) / 2;
      const y = (a[1] + b[1]) / 2;
      if (x < 70 || x > VIEW_W - 70 || y < 30 || y > VIEW_H - 30) continue;
      if (avoid.some(([px, py]) => Math.hypot(px - x, py - y) < 70)) continue;
      if (!best || len > best.len) {
        let angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
        if (angle > 90) angle -= 180;
        if (angle < -90) angle += 180;
        best = { x, y, angle, len };
      }
    }
  }
  return best;
}

async function main() {
  const elements = await loadOsm();
  const ways = elements.filter((e): e is OsmWay => e.type === 'way');
  const relations = elements.filter((e): e is OsmRelation => e.type === 'relation');

  // Water: standalone polygons plus river multipolygons (islands as holes).
  const waterPaths: string[] = [];
  for (const w of ways.filter((w) => w.tags.natural === 'water')) {
    const pts = simplify(toPts(w.geometry), 0.5);
    if (inFrame(pts) && pts.length > 2) waterPaths.push(pathOf(pts, true));
  }
  for (const r of relations) {
    const rings = stitchRings(r.members.filter((m) => m.geometry).map((m) => toPts(m.geometry!)))
      .map((ring) => simplify(ring, 0.5))
      .filter((ring) => ring.length > 2 && inFrame(ring));
    if (rings.length) waterPaths.push(rings.map((ring) => pathOf(ring, true)).join(''));
  }

  const parkPaths = ways
    .filter((w) => w.tags.leisure === 'park')
    .map((w) => simplify(toPts(w.geometry), 0.5))
    .filter((pts) => pts.length > 2 && inFrame(pts))
    .map((pts) => pathOf(pts, true));

  const roadLayers = ROAD_TIERS.map((tier) => {
    const d = ways
      .filter((w) => tier.kinds.includes(w.tags.highway))
      .map((w) => simplify(toPts(w.geometry)))
      .filter(inFrame)
      .map((pts) => pathOf(pts))
      .join('');
    return `<path d="${d}" fill="none" stroke="${tier.stroke}" stroke-width="${tier.width}" stroke-linecap="round" stroke-linejoin="round"/>`;
  });

  const markers = loadServicePoints();
  const roadLabelEls: string[] = [];
  for (const spec of ROAD_LABELS) {
    const lines = ways
      .filter((w) => (spec.ref ? w.tags.ref?.split(';').includes(spec.ref) : w.tags.name === spec.name))
      .map((w) => simplify(toPts(w.geometry), 1.2));
    const spot = placeRoadLabel(lines, spec.label, markers);
    if (!spot) {
      console.warn(`no clear spot for ${spec.label}`);
      continue;
    }
    roadLabelEls.push(
      `<text x="${fmt(spot.x)}" y="${fmt(spot.y)}" transform="rotate(${fmt(spot.angle)} ${fmt(spot.x)} ${fmt(spot.y)})" dy="4">${spec.label}</text>`
    );
  }

  const areaLabelEls = AREA_LABELS.map(({ label, lat, lon, angle, water }) => {
    const { x, y } = project(lat, lon);
    const rotate = angle ? ` transform="rotate(${angle} ${fmt(x)} ${fmt(y)})"` : '';
    const style = water ? ' font-style="italic" fill="rgb(147 197 253 / 0.55)" stroke="none"' : '';
    return `<text x="${fmt(x)}" y="${fmt(y)}"${rotate}${style}>${label}</text>`;
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" font-family="'Public Sans', ui-sans-serif, system-ui, sans-serif">
<!-- Generated by scripts/build-detroit-basemap.ts. Map data (c) OpenStreetMap contributors, ODbL. -->
<rect width="${VIEW_W}" height="${VIEW_H}" fill="#0c1719"/>
<g fill="#12291f">${parkPaths.map((d) => `<path d="${d}"/>`).join('')}</g>
<g fill="#0f2a42" fill-rule="evenodd" stroke="rgb(96 165 250 / 0.3)" stroke-width="1">${waterPaths.map((d) => `<path d="${d}"/>`).join('')}</g>
<g>${roadLayers.join('')}</g>
<g font-size="12" font-weight="500" fill="rgb(233 229 220 / 0.5)" text-anchor="middle" stroke="#0c1719" stroke-width="3" paint-order="stroke">${roadLabelEls.join('')}</g>
<g font-size="15" font-weight="600" letter-spacing="0.04em" fill="rgb(233 229 220 / 0.3)" text-anchor="middle" stroke="#0c1719" stroke-width="4" paint-order="stroke">${areaLabelEls.join('')}</g>
</svg>
`;
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, svg);
  console.log(
    `wrote ${OUT} (${(svg.length / 1024).toFixed(0)} KB): ${waterPaths.length} water, ${parkPaths.length} parks, ${roadLabelEls.length} road labels`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
