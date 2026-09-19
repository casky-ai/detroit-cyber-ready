'use client';

import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { ServiceSummary } from '@/lib/api-types';
import { computeServiceStatus, type ServiceStatus } from '@/lib/status';

// CARTO's dark-matter basemap: free, no API key required. Chosen because
// this is a SOC-style dashboard, not a tourism map — a dark basemap keeps
// the colored status markers as the only thing that draws the eye.
const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const STATUS_COLOR: Record<ServiceStatus, string> = {
  ok: '#3ecf8e', // matches --status-ok
  'at-risk': '#e0b341', // matches --status-at-risk
  critical: '#e5484d', // matches --status-critical
};

interface DetroitMapProps {
  services: ServiceSummary[];
  onSelect: (service: ServiceSummary) => void;
}

export function DetroitMap({ services, onSelect }: DetroitMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  // Keep the latest onSelect without re-running the marker-build effect —
  // markers are rebuilt only when the service list itself changes.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapRef.current = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: [-83.0458, 42.345],
      zoom: 11.3,
      attributionControl: false,
    });
    mapRef.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // map is passed explicitly rather than closed over: TypeScript does not
    // narrow a closed-over `const` across a nested function declaration's
    // boundary, so `map` would still type as `Map | null` inside otherwise.
    function buildMarkers(map: maplibregl.Map) {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      for (const service of services) {
        const status = computeServiceStatus(service.latest_investigation);
        const el = document.createElement('button');
        el.setAttribute('aria-label', service.name);
        el.style.width = service.criticality === 'life-safety' ? '22px' : '16px';
        el.style.height = el.style.width;
        el.style.borderRadius = '50%';
        el.style.background = STATUS_COLOR[status];
        el.style.border = service.criticality === 'life-safety' ? '3px solid white' : '2px solid rgba(255,255,255,0.6)';
        el.style.boxShadow = status === 'critical' ? `0 0 12px 4px ${STATUS_COLOR[status]}88` : 'none';
        el.style.cursor = 'pointer';
        el.style.padding = '0';
        if (status === 'critical' || status === 'at-risk') {
          el.style.animation = 'pulse-marker 1.6s ease-in-out infinite';
        }
        el.onclick = () => onSelectRef.current(service);

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([service.lon, service.lat])
          .setPopup(new maplibregl.Popup({ offset: 16, closeButton: false }).setText(service.name))
          .addTo(map);
        markersRef.current.push(marker);
      }
    }

    if (map.isStyleLoaded()) buildMarkers(map);
    else map.once('load', () => buildMarkers(map));

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
  }, [services]);

  return (
    <>
      <style>{`
        @keyframes pulse-marker {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.25); }
        }
      `}</style>
      <div ref={containerRef} className="h-[420px] w-full rounded-lg border border-border sm:h-[520px]" />
    </>
  );
}
