'use client';

import { useMemo, type KeyboardEvent } from 'react';
import type { ServiceSummary } from '@/lib/api-types';
import { computeServiceStatus, STATUS_LABEL, type ServiceStatus } from '@/lib/status';

// A self-contained SVG map: zero external network requests. This replaces
// two consecutive tile-based basemap attempts (CARTO, then OpenFreeMap)
// that both returned 200 with open CORS when checked directly from the
// server, yet still failed to render for one specific viewer, meaning
// something in that browser/network (firewall, extension, corporate proxy)
// blocks external map tile CDNs specifically, not this app or its code. A
// demo cannot depend on a viewer's specific network conditions, so this
// draws the same information without needing any tile server: real
// geocoded coordinates for every service, projected into plain SVG space.
//
// The Detroit River curve is decorative geography for orientation, not a
// claim of surveyed accuracy; it is not read from any GeoJSON source.

// CSS variables from globals.css, so the map shares one palette with the
// rest of the app instead of carrying its own hex values.
const STATUS_FILL: Record<ServiceStatus, string> = {
  ok: 'var(--status-ok)',
  'at-risk': 'var(--status-at-risk)',
  critical: 'var(--status-critical)',
};

// Padded slightly beyond the real min/max across all 12 geocoded addresses
// (lat 42.329 to 42.368, lon -83.078 to -83.044) so markers never sit at the
// literal edge of the view.
const BOUNDS = { minLat: 42.322, maxLat: 42.374, minLon: -83.086, maxLon: -83.036 };
const VIEW_W = 1000;
const VIEW_H = 640;

// Services that share a building (Police and 911 at Public Safety HQ, for
// example) would otherwise draw one marker on top of another. Points closer
// than this are fanned out around their shared center.
const CLUSTER_PX = 14;
const FAN_RADIUS_PX = 26;
const LABEL_FONT_PX = 12;
const LABEL_CHAR_PX = 6.6;

function project(lat: number, lon: number): { x: number; y: number } {
  const x = ((lon - BOUNDS.minLon) / (BOUNDS.maxLon - BOUNDS.minLon)) * VIEW_W;
  // Latitude increases northward; SVG y increases downward, so invert.
  const y = ((BOUNDS.maxLat - lat) / (BOUNDS.maxLat - BOUNDS.minLat)) * VIEW_H;
  return { x, y };
}

interface Point {
  service: ServiceSummary;
  status: ServiceStatus;
  x: number;
  y: number;
  r: number;
  label: { x: number; y: number; anchor: 'start' | 'middle' | 'end' };
}

interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function overlaps(a: Rect, b: Rect) {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

function fanOut(raw: Array<{ service: ServiceSummary; x: number; y: number }>) {
  const clusters: Array<typeof raw> = [];
  for (const p of raw) {
    const home = clusters.find((c) => Math.hypot(c[0].x - p.x, c[0].y - p.y) < CLUSTER_PX);
    if (home) home.push(p);
    else clusters.push([p]);
  }
  return clusters.flatMap((cluster) => {
    if (cluster.length === 1) return cluster;
    const cx = cluster.reduce((s, p) => s + p.x, 0) / cluster.length;
    const cy = cluster.reduce((s, p) => s + p.y, 0) / cluster.length;
    // Spread horizontally first so both labels stay readable.
    return cluster.map((p, i) => {
      const angle = Math.PI + (i * 2 * Math.PI) / cluster.length;
      return { ...p, x: cx + FAN_RADIUS_PX * Math.cos(angle), y: cy + FAN_RADIUS_PX * 0.6 * Math.sin(angle) };
    });
  });
}

// Greedy label placement: try above, below, right, then left of each
// marker, and take the first slot that does not collide with a label or a
// marker already placed.
function placeLabels(points: Array<Omit<Point, 'label'>>): Point[] {
  const taken: Rect[] = points.map((p) => ({ x1: p.x - p.r, y1: p.y - p.r, x2: p.x + p.r, y2: p.y + p.r }));
  const ordered = [...points].sort((a, b) => a.y - b.y);
  const placed = new Map<string, Point['label']>();

  for (const p of ordered) {
    const w = p.service.name.length * LABEL_CHAR_PX;
    const h = LABEL_FONT_PX + 2;
    const gap = p.r + 6;
    const candidates: Array<{ label: Point['label']; rect: Rect }> = [
      { label: { x: p.x, y: p.y - gap, anchor: 'middle' }, rect: { x1: p.x - w / 2, y1: p.y - gap - h, x2: p.x + w / 2, y2: p.y - gap } },
      { label: { x: p.x, y: p.y + gap + h - 2, anchor: 'middle' }, rect: { x1: p.x - w / 2, y1: p.y + gap, x2: p.x + w / 2, y2: p.y + gap + h } },
      { label: { x: p.x + gap, y: p.y + 4, anchor: 'start' }, rect: { x1: p.x + gap, y1: p.y - h / 2, x2: p.x + gap + w, y2: p.y + h / 2 } },
      { label: { x: p.x - gap, y: p.y + 4, anchor: 'end' }, rect: { x1: p.x - gap - w, y1: p.y - h / 2, x2: p.x - gap, y2: p.y + h / 2 } },
    ];
    const free = candidates.find((c) => !taken.some((t) => overlaps(t, c.rect))) ?? candidates[0];
    taken.push(free.rect);
    placed.set(p.service.slug, free.label);
  }

  return points.map((p) => ({ ...p, label: placed.get(p.service.slug)! }));
}

interface DetroitMapProps {
  services: ServiceSummary[];
  selectedSlug?: string | null;
  onSelect: (service: ServiceSummary) => void;
}

export function DetroitMap({ services, selectedSlug, onSelect }: DetroitMapProps) {
  const points = useMemo(() => {
    const raw = services.map((service) => ({ service, ...project(service.lat, service.lon) }));
    const spread = fanOut(raw).map((p) => ({
      ...p,
      status: computeServiceStatus(p.service.latest_investigation),
      r: p.service.criticality === 'life-safety' ? 11 : 8,
    }));
    return placeLabels(spread);
  }, [services]);

  function handleKey(e: KeyboardEvent, service: ServiceSummary) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(service);
    }
  }

  return (
    <div className="relative h-[420px] w-full overflow-hidden rounded-xl border border-border bg-[oklch(0.13_0.02_255)] sm:h-[520px]">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-full w-full select-none"
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label="Map of downtown Detroit city services"
      >
        <defs>
          <pattern id="dcr-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.045)" strokeWidth="1" />
          </pattern>
          <radialGradient id="dcr-vignette" cx="50%" cy="45%" r="70%">
            <stop offset="60%" stopColor="black" stopOpacity="0" />
            <stop offset="100%" stopColor="black" stopOpacity="0.45" />
          </radialGradient>
        </defs>
        <rect width={VIEW_W} height={VIEW_H} fill="url(#dcr-grid)" />

        {/* The Detroit River: decorative orientation, not surveyed geography. */}
        <path
          d={`M -20 ${VIEW_H - 60} Q ${VIEW_W * 0.3} ${VIEW_H - 20}, ${VIEW_W * 0.6} ${VIEW_H - 70} T ${VIEW_W + 20} ${VIEW_H - 90}`}
          fill="none"
          stroke="oklch(0.55 0.1 240 / 0.3)"
          strokeWidth="28"
          strokeLinecap="round"
        />
        <text x={VIEW_W - 150} y={VIEW_H - 28} fill="rgba(255,255,255,0.28)" fontSize="13" fontStyle="italic">
          Detroit River
        </text>
        <rect width={VIEW_W} height={VIEW_H} fill="url(#dcr-vignette)" pointerEvents="none" />

        {points.map(({ service, x, y, r, status, label }) => {
          const selected = service.slug === selectedSlug;
          const lifeSafety = service.criticality === 'life-safety';
          const alarming = status === 'critical' || status === 'at-risk';
          return (
            <g
              key={service.slug}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={`${service.name}, ${STATUS_LABEL[status]}${lifeSafety ? ', life-safety' : ''}`}
              className="group cursor-pointer outline-none"
              onClick={() => onSelect(service)}
              onKeyDown={(e) => handleKey(e, service)}
            >
              <title>{`${service.name}\n${service.address}`}</title>
              {/* Oversized invisible hit area so small markers are easy to tap. */}
              <circle cx={x} cy={y} r={r + 12} fill="transparent" />
              {alarming && (
                <circle cx={x} cy={y} r={r + 6} style={{ fill: STATUS_FILL[status] }} opacity={0.25}>
                  <animate attributeName="r" values={`${r};${r + 10};${r}`} dur="1.6s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.4;0.04;0.4" dur="1.6s" repeatCount="indefinite" />
                </circle>
              )}
              {/* Selection and keyboard-focus ring. */}
              <circle
                cx={x}
                cy={y}
                r={r + 6}
                fill="none"
                stroke="var(--brand-gold)"
                strokeWidth={2}
                className={`transition-opacity duration-200 ${selected ? 'opacity-100' : 'opacity-0 group-focus-visible:opacity-100'}`}
              />
              <circle
                cx={x}
                cy={y}
                r={r}
                style={{ fill: STATUS_FILL[status], transformBox: 'fill-box', transformOrigin: 'center' }}
                stroke={lifeSafety ? 'white' : 'rgba(255,255,255,0.6)'}
                strokeWidth={lifeSafety ? 3 : 2}
                className="transition-transform duration-200 ease-out group-hover:scale-125"
              />
              <text
                x={label.x}
                y={label.y}
                textAnchor={label.anchor}
                fontSize={LABEL_FONT_PX}
                fontWeight={selected ? 700 : 600}
                fill={selected ? 'var(--brand-gold)' : 'rgba(255,255,255,0.85)'}
                paintOrder="stroke"
                stroke="oklch(0.13 0.02 255)"
                strokeWidth={4}
                strokeLinejoin="round"
                className="pointer-events-none transition-colors"
              >
                {service.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
