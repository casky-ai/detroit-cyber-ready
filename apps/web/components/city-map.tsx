'use client';

import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from 'cn';
import type { ServiceSummary } from '@/lib/api-types';
import { VIEW_H, VIEW_W, project } from '@/lib/map-projection';
import { computeServiceStatus, STATUS_LABEL, type ServiceStatus } from '@/lib/status';

// The city map: a street basemap built from OpenStreetMap at build time
// (scripts/build-detroit-basemap.ts) and served from this app's own origin,
// with service pins drawn on top in the same projection. No tile server and
// no third-party request at runtime, so it renders the same on any network.

const BASEMAP_URL = '/maps/detroit-basemap.svg';

const STATUS_FILL: Record<ServiceStatus, string> = {
  ok: 'var(--status-ok)',
  'at-risk': 'var(--status-at-risk)',
  critical: 'var(--status-critical)',
};

export interface BasemapLoad {
  state: 'loading' | 'ready' | 'error';
  ms?: number;
  kb?: number;
}

// Fetched once per page load and shared by every map instance on the page.
let basemapPromise: Promise<{ inner: string; ms: number; kb: number }> | null = null;
function loadBasemap() {
  if (!basemapPromise) {
    const started = performance.now();
    basemapPromise = fetch(BASEMAP_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`basemap ${r.status}`);
        return r.text();
      })
      .then((text) => ({
        // Inline the drawing (not an <img>) so its labels use the page's
        // Public Sans instead of a system fallback.
        inner: text.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, ''),
        ms: Math.round(performance.now() - started),
        kb: Math.round(text.length / 1024),
      }))
      .catch((err) => {
        basemapPromise = null;
        throw err;
      });
  }
  return basemapPromise;
}

// Pins at one address (Police and 911 share Public Safety HQ) fan out so
// neither hides the other.
const CLUSTER_PX = 16;
const FAN_PX = 20;
const LABEL_PX = 14;
const CHAR_PX = 7.6;
const CHIP_PAD_X = 8;
const CHIP_H = 24;

type Anchor = 'right' | 'left' | 'above' | 'below';
interface Pin {
  service: ServiceSummary;
  status: ServiceStatus;
  x: number;
  y: number;
  scale: number;
  chip: { x: number; y: number; w: number };
}

interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
const overlaps = (a: Rect, b: Rect) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

function layoutPins(services: ServiceSummary[]): Pin[] {
  const raw = services.map((service) => ({ service, ...project(service.lat, service.lon) }));
  const groups: Array<typeof raw> = [];
  for (const p of raw) {
    const g = groups.find((c) => Math.hypot(c[0].x - p.x, c[0].y - p.y) < CLUSTER_PX);
    if (g) g.push(p);
    else groups.push([p]);
  }
  const spread = groups.flatMap((g) =>
    g.length === 1
      ? g
      : g.map((p, i) => ({ ...p, x: p.x + (i - (g.length - 1) / 2) * FAN_PX * 1.6, y: p.y }))
  );

  // Pin heads occupy space too, so chips never cover another pin.
  const taken: Rect[] = spread.map((p) => ({ x1: p.x - 12, y1: p.y - 34, x2: p.x + 12, y2: p.y }));
  const inView = (r: Rect) => r.x1 >= 6 && r.x2 <= VIEW_W - 6 && r.y1 >= 6 && r.y2 <= VIEW_H - 6;

  return [...spread]
    .sort((a, b) => a.y - b.y)
    .map((p) => {
      const scale = p.service.criticality === 'life-safety' ? 1.25 : 1;
      const w = p.service.name.length * CHAR_PX + CHIP_PAD_X * 2;
      const headY = p.y - 22 * scale;
      const slots: Record<Anchor, Rect> = {
        right: { x1: p.x + 16, y1: headY - CHIP_H / 2, x2: p.x + 16 + w, y2: headY + CHIP_H / 2 },
        left: { x1: p.x - 16 - w, y1: headY - CHIP_H / 2, x2: p.x - 16, y2: headY + CHIP_H / 2 },
        above: { x1: p.x - w / 2, y1: headY - 20 - CHIP_H, x2: p.x + w / 2, y2: headY - 20 },
        below: { x1: p.x - w / 2, y1: p.y + 6, x2: p.x + w / 2, y2: p.y + 6 + CHIP_H },
      };
      const order: Anchor[] = ['right', 'left', 'above', 'below'];
      const pick =
        order.find((a) => inView(slots[a]) && !taken.some((t) => overlaps(t, slots[a]))) ??
        order.find((a) => inView(slots[a])) ??
        'right';
      const r = slots[pick];
      taken.push(r);
      return {
        service: p.service,
        status: computeServiceStatus(p.service.latest_investigation),
        x: p.x,
        y: p.y,
        scale,
        chip: { x: r.x1, y: r.y1, w },
      };
    });
}

// Teardrop pin with its tip at (0, 0).
const PIN_PATH = 'M0 0C-1.5-5-11-11-11-21A11 11 0 1 1 11-21C11-11 1.5-5 0 0Z';

interface CityMapProps {
  services: ServiceSummary[];
  selectedSlug?: string | null;
  onSelect?: (service: ServiceSummary) => void;
  /** A pin to call out without a click, such as the service a finding reaches. */
  calloutSlug?: string | null;
  renderCallout?: (service: ServiceSummary, status: ServiceStatus) => ReactNode;
  onBasemapLoad?: (load: BasemapLoad) => void;
  className?: string;
}

export function CityMap({
  services,
  selectedSlug,
  onSelect,
  calloutSlug,
  renderCallout,
  onBasemapLoad,
  className,
}: CityMapProps) {
  const [basemap, setBasemap] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const pins = useMemo(() => layoutPins(services), [services]);

  useEffect(() => {
    let live = true;
    onBasemapLoad?.({ state: 'loading' });
    loadBasemap()
      .then(({ inner, ms, kb }) => {
        if (!live) return;
        setBasemap(inner);
        onBasemapLoad?.({ state: 'ready', ms, kb });
      })
      .catch(() => {
        if (!live) return;
        setFailed(true);
        onBasemapLoad?.({ state: 'error' });
      });
    return () => {
      live = false;
    };
    // onBasemapLoad is a reporting hook; re-running on its identity would refetch nothing but re-report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const calloutPin = pins.find((p) => p.service.slug === (calloutSlug ?? selectedSlug));

  function handleKey(e: KeyboardEvent, service: ServiceSummary) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(service);
    }
  }

  return (
    <div
      className={cn('relative w-full overflow-hidden rounded-xl bg-[#0c1719] ring-1 ring-foreground/10', className)}
      style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
    >
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="absolute inset-0 h-full w-full select-none"
        role="group"
        aria-label="Street map of downtown Detroit with city service locations"
      >
        {/* First-party, build-time asset from our own origin. Its only text
            is labels from fixed lists in the build script; no user or
            third-party strings reach this markup. */}
        <g
          className="transition-opacity duration-700 ease-out"
          style={{ opacity: basemap ? 1 : 0 }}
          dangerouslySetInnerHTML={basemap ? { __html: basemap } : undefined}
        />

        {pins.map(({ service, status, x, y, scale, chip }) => {
          const selected = service.slug === selectedSlug || service.slug === calloutSlug;
          const alarming = status !== 'ok';
          return (
            <g
              key={service.slug}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={`${service.name}, ${STATUS_LABEL[status]}`}
              className="group cursor-pointer outline-none"
              onClick={() => onSelect?.(service)}
              onKeyDown={(e) => handleKey(e, service)}
            >
              {alarming && (
                <ellipse cx={x} cy={y} rx={10 * scale} ry={4 * scale} fill="none" stroke={STATUS_FILL[status]} strokeWidth={2}>
                  <animate attributeName="rx" values={`${6 * scale};${28 * scale}`} dur="1.8s" repeatCount="indefinite" />
                  <animate attributeName="ry" values={`${2.4 * scale};${11 * scale}`} dur="1.8s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.9;0" dur="1.8s" repeatCount="indefinite" />
                </ellipse>
              )}
              <ellipse cx={x} cy={y} rx={7 * scale} ry={2.5 * scale} fill="black" opacity={0.45} />
              <g
                transform={`translate(${x} ${y}) scale(${scale})`}
                className="transition-transform duration-200 ease-out"
              >
                <g className="origin-bottom transition-transform duration-200 group-hover:scale-110 group-focus-visible:scale-110 [transform-box:fill-box]">
                  <path
                    d={PIN_PATH}
                    style={{ fill: STATUS_FILL[status] }}
                    stroke={selected ? 'var(--brand-gold)' : 'rgb(12 23 25 / 0.9)'}
                    strokeWidth={selected ? 2.5 : 1.5}
                  />
                  <circle cx={0} cy={-21} r={4.2} fill="#0c1719" opacity={0.85} />
                </g>
              </g>
              <g className="pointer-events-none">
                <rect
                  x={chip.x}
                  y={chip.y}
                  width={chip.w}
                  height={CHIP_H}
                  rx={6}
                  fill="rgb(12 23 25 / 0.86)"
                  stroke={selected ? 'var(--brand-gold)' : 'rgb(233 229 220 / 0.14)'}
                />
                <text
                  x={chip.x + chip.w / 2}
                  y={chip.y + CHIP_H / 2 + 5}
                  textAnchor="middle"
                  fontSize={LABEL_PX}
                  fontWeight={600}
                  fill={selected ? 'var(--brand-gold)' : '#e9e5dc'}
                >
                  {service.name}
                </text>
              </g>
            </g>
          );
        })}
      </svg>

      {!basemap && !failed && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center">
          <span className="rounded-full bg-background/80 px-3 py-1 text-xs text-muted-foreground">Loading street map</span>
        </div>
      )}
      {failed && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center">
          <span className="rounded-full bg-background/80 px-3 py-1 text-xs text-status-at-risk">
            Street map could not load; service locations are still accurate.
          </span>
        </div>
      )}

      {calloutPin && renderCallout && (
        <div
          key={calloutPin.service.slug}
          className="pointer-events-auto absolute z-10 w-64 -translate-x-1/2 animate-in fade-in-0 zoom-in-95 duration-300"
          style={{
            left: `${Math.min(Math.max((calloutPin.x / VIEW_W) * 100, 16), 84)}%`,
            // Above the pin when there is room, otherwise below it.
            ...(calloutPin.y > VIEW_H * 0.42
              ? { bottom: `${((VIEW_H - calloutPin.y + 38 * calloutPin.scale) / VIEW_H) * 100}%` }
              : { top: `${((calloutPin.y + 10) / VIEW_H) * 100}%` }),
          }}
        >
          {renderCallout(calloutPin.service, calloutPin.status)}
        </div>
      )}

      <span className="pointer-events-none absolute right-2 bottom-1.5 text-[10px] text-foreground/40">
        Map data © OpenStreetMap contributors
      </span>
    </div>
  );
}
