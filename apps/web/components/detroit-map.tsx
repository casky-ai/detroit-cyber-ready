'use client';

import { useMemo } from 'react';
import type { ServiceSummary } from '@/lib/api-types';
import { computeServiceStatus, type ServiceStatus } from '@/lib/status';

// A self-contained SVG map: zero external network requests. This replaces
// two consecutive tile-based basemap attempts (CARTO, then OpenFreeMap)
// that both returned 200 with open CORS when checked directly from the
// server, yet still failed to render for one specific viewer — meaning
// something in that browser/network (firewall, extension, corporate proxy)
// blocks external map tile CDNs specifically, not this app or its code. A
// demo cannot depend on a viewer's specific network conditions, so this
// draws the same information without needing any tile server: real
// geocoded coordinates for every service, projected into plain SVG space.
//
// The Detroit River curve is decorative geography for orientation, not a
// claim of surveyed accuracy — it is not read from any GeoJSON source.

const STATUS_COLOR: Record<ServiceStatus, string> = {
  ok: '#3ecf8e',
  'at-risk': '#e0b341',
  critical: '#e5484d',
};

// Padded slightly beyond the real min/max across all 12 geocoded addresses
// (lat 42.329–42.368, lon -83.078– -83.044) so markers never sit at the
// literal edge of the view.
const BOUNDS = { minLat: 42.322, maxLat: 42.374, minLon: -83.086, maxLon: -83.036 };
const VIEW_W = 1000;
const VIEW_H = 640;

function project(lat: number, lon: number): { x: number; y: number } {
  const x = ((lon - BOUNDS.minLon) / (BOUNDS.maxLon - BOUNDS.minLon)) * VIEW_W;
  // Latitude increases northward; SVG y increases downward, so invert.
  const y = ((BOUNDS.maxLat - lat) / (BOUNDS.maxLat - BOUNDS.minLat)) * VIEW_H;
  return { x, y };
}

interface DetroitMapProps {
  services: ServiceSummary[];
  onSelect: (service: ServiceSummary) => void;
}

export function DetroitMap({ services, onSelect }: DetroitMapProps) {
  const points = useMemo(
    () =>
      services.map((service) => {
        const { x, y } = project(service.lat, service.lon);
        const status = computeServiceStatus(service.latest_investigation);
        return { service, x, y, status };
      }),
    [services]
  );

  return (
    <div className="relative h-[420px] w-full overflow-hidden rounded-lg border border-border bg-[#0a0d14] sm:h-[520px]">
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={VIEW_W} height={VIEW_H} fill="url(#grid)" />

        {/* The Detroit River: decorative orientation, not surveyed geography. */}
        <path
          d={`M -20 ${VIEW_H - 60} Q ${VIEW_W * 0.3} ${VIEW_H - 20}, ${VIEW_W * 0.6} ${VIEW_H - 70} T ${VIEW_W + 20} ${VIEW_H - 90}`}
          fill="none"
          stroke="rgba(62,140,207,0.35)"
          strokeWidth="26"
          strokeLinecap="round"
        />
        <text x={VIEW_W - 140} y={VIEW_H - 30} fill="rgba(255,255,255,0.25)" fontSize="14" fontStyle="italic">
          Detroit River
        </text>

        {points.map(({ service, x, y, status }) => (
          <g key={service.slug} className="cursor-pointer" onClick={() => onSelect(service)}>
            {(status === 'critical' || status === 'at-risk') && (
              <circle cx={x} cy={y} r={service.criticality === 'life-safety' ? 18 : 13} fill={STATUS_COLOR[status]} opacity={0.25}>
                <animate attributeName="r" values={`${service.criticality === 'life-safety' ? 11 : 8};${service.criticality === 'life-safety' ? 20 : 15};${service.criticality === 'life-safety' ? 11 : 8}`} dur="1.6s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.35;0.05;0.35" dur="1.6s" repeatCount="indefinite" />
              </circle>
            )}
            <circle
              cx={x}
              cy={y}
              r={service.criticality === 'life-safety' ? 11 : 8}
              fill={STATUS_COLOR[status]}
              stroke={service.criticality === 'life-safety' ? 'white' : 'rgba(255,255,255,0.6)'}
              strokeWidth={service.criticality === 'life-safety' ? 3 : 2}
            />
            <text x={x} y={y - 16} textAnchor="middle" fill="rgba(255,255,255,0.85)" fontSize="12" fontWeight={600}>
              {service.name}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
