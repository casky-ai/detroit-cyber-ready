'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { cn } from 'cn';
import { Building2, MapPin, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { CityMap, type BasemapLoad } from '@/components/city-map';
import type { ServiceSummary } from '@/lib/api-types';
import { computeServiceStatus, STATUS_LABEL, type ServiceStatus } from '@/lib/status';

// The dashboard frame from the demo storyboard: identity and live clock,
// tabs, the city map, and the service counts. The same frame appears in
// step 1 (all clear) and step 4 (risk identified) so the audience sees one
// board change state, not two different screens.

export interface BoardSignal {
  id: string;
  external_id: string;
  title: string;
  provenance: 'live' | 'synthetic';
  published_at: string;
  matches: Array<{ service_slug: string }>;
}

const STATUS_BG: Record<ServiceStatus, string> = {
  ok: 'bg-status-ok',
  'at-risk': 'bg-status-at-risk',
  critical: 'bg-status-critical',
};
const STATUS_TEXT: Record<ServiceStatus, string> = {
  ok: 'text-status-ok',
  'at-risk': 'text-status-at-risk',
  critical: 'text-status-critical',
};
const CRITICALITY_ORDER: Record<ServiceSummary['criticality'], number> = {
  'life-safety': 0,
  critical: 1,
  high: 2,
  moderate: 3,
  low: 4,
};

type Tab = 'map' | 'services' | 'intel' | 'alerts' | 'reports';

function useDetroitNow() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // First tick deferred so the server render and hydration agree.
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  return now;
}

const DETROIT = 'America/Detroit';

export function statusSummary(services: ServiceSummary[]) {
  const counts = { ok: 0, 'at-risk': 0, critical: 0 } as Record<ServiceStatus, number>;
  for (const s of services) counts[computeServiceStatus(s.latest_investigation)]++;
  const flagged = counts['at-risk'] + counts.critical;
  const headline =
    flagged === 0
      ? 'All systems operational'
      : `${flagged} service${flagged === 1 ? '' : 's'} ${counts.critical > 0 ? 'critical' : 'at risk'}`;
  return { counts, flagged, headline };
}

function ServiceCallout({ service, status, onClose }: { service: ServiceSummary; status: ServiceStatus; onClose?: () => void }) {
  return (
    <div className="rounded-xl bg-popover/95 p-3.5 text-sm shadow-2xl ring-1 ring-foreground/15 backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold leading-tight">{service.name}</p>
          <p className={cn('mt-0.5 text-xs font-semibold', STATUS_TEXT[status])}>
            {STATUS_LABEL[status]}
            {service.latest_investigation?.priority ? `, ${service.latest_investigation.priority}` : ''}
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close"
            className="-m-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <p className="mt-2 flex gap-1.5 text-xs text-muted-foreground">
        <MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        {service.address}
      </p>
      <p className="mt-2 line-clamp-3 text-xs text-pretty">{service.resident_impact}</p>
      {service.latest_investigation && (
        <Link
          href={`/investigations/${service.latest_investigation.id}`}
          className={cn(buttonVariants({ size: 'sm', variant: 'secondary' }), 'mt-3 w-full')}
        >
          Open the investigation
        </Link>
      )}
    </div>
  );
}

export function CityBoard({
  services,
  signals,
  calloutSlug,
  footer,
  onBasemapLoad,
}: {
  services: ServiceSummary[];
  signals?: BoardSignal[] | null;
  /** Force a callout on one pin, used when a finding lands on a service. */
  calloutSlug?: string | null;
  footer?: ReactNode;
  onBasemapLoad?: (load: BasemapLoad) => void;
}) {
  const [tab, setTab] = useState<Tab>('map');
  const [selected, setSelected] = useState<string | null>(null);
  const now = useDetroitNow();
  const { counts, flagged, headline } = statusSummary(services);
  const alerts = services.filter((s) => computeServiceStatus(s.latest_investigation) !== 'ok');
  const ordered = [...services].sort((a, b) => CRITICALITY_ORDER[a.criticality] - CRITICALITY_ORDER[b.criticality]);
  const overallTone: ServiceStatus = counts.critical > 0 ? 'critical' : counts['at-risk'] > 0 ? 'at-risk' : 'ok';

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'map', label: 'City map' },
    { id: 'services', label: 'Services' },
    { id: 'intel', label: 'Threat intel' },
    { id: 'alerts', label: 'Alerts', count: alerts.length },
    { id: 'reports', label: 'Reports' },
  ];

  function openOnMap(slug: string) {
    setSelected(slug);
    setTab('map');
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-verdigris/15 text-brand-verdigris ring-1 ring-brand-verdigris/30">
            <Building2 className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <p className="text-lg font-bold leading-tight">Detroit Cyber Ready</p>
            <p className="text-xs text-muted-foreground">City services, real-time cyber readiness</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground" suppressHydrationWarning>
            {now?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: DETROIT })}
          </p>
          <p className="text-lg font-bold tabular-nums leading-tight" suppressHydrationWarning>
            {now?.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: DETROIT })}
          </p>
          <p key={headline} className={cn('mt-0.5 flex animate-in items-center justify-end gap-1.5 text-xs font-semibold fade-in-0 duration-500', STATUS_TEXT[overallTone])}>
            <span className={cn('h-2 w-2 rounded-full', STATUS_BG[overallTone])} aria-hidden />
            {headline}
          </p>
        </div>
      </div>

      <div role="tablist" aria-label="Board views" className="flex gap-1 overflow-x-auto px-4 sm:px-5">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'relative flex shrink-0 items-center gap-1.5 rounded-t-lg px-3.5 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              tab === t.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
            {!!t.count && (
              <span className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-status-critical px-1 text-[10px] font-bold text-white tabular-nums">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="bg-muted/40 p-2 sm:p-3">
        {tab === 'map' && (
          <CityMap
            services={services}
            selectedSlug={selected}
            onSelect={(s) => setSelected((prev) => (prev === s.slug ? null : s.slug))}
            calloutSlug={selected ? null : calloutSlug}
            onBasemapLoad={onBasemapLoad}
            renderCallout={(service, status) => (
              <ServiceCallout
                service={service}
                status={status}
                onClose={selected ? () => setSelected(null) : undefined}
              />
            )}
          />
        )}

        {tab === 'services' && (
          <ul className="divide-y divide-border rounded-xl bg-card ring-1 ring-foreground/10">
            {ordered.map((s) => {
              const status = computeServiceStatus(s.latest_investigation);
              return (
                <li key={s.slug}>
                  <button
                    onClick={() => openOnMap(s.slug)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                  >
                    <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', STATUS_BG[status])} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{s.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{s.department}</span>
                    </span>
                    {s.criticality === 'life-safety' && (
                      <Badge variant="outline" className="text-[10px] text-brand-gold">
                        Life-safety
                      </Badge>
                    )}
                    <span className={cn('w-20 text-right text-xs font-semibold', STATUS_TEXT[status])}>{STATUS_LABEL[status]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {tab === 'intel' && (
          <ul className="divide-y divide-border rounded-xl bg-card ring-1 ring-foreground/10">
            {(signals ?? []).length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">No signals yet.</li>}
            {(signals ?? []).map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="w-32 shrink-0 tabular-nums text-muted-foreground">{s.external_id}</span>
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                {s.matches.length > 0 ? (
                  <Badge variant="outline" className="shrink-0 text-[10px] text-status-at-risk">
                    Reaches {new Set(s.matches.map((m) => m.service_slug)).size} services
                  </Badge>
                ) : (
                  <span className="shrink-0 text-xs text-status-ok">No Detroit exposure</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {tab === 'alerts' && (
          <ul className="divide-y divide-border rounded-xl bg-card ring-1 ring-foreground/10">
            {alerts.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">No open alerts.</li>}
            {alerts.map((s) => {
              const status = computeServiceStatus(s.latest_investigation);
              return (
                <li key={s.slug}>
                  <button onClick={() => openOnMap(s.slug)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50">
                    <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', STATUS_BG[status])} aria-hidden />
                    <span className="flex-1 font-medium">{s.name}</span>
                    {s.latest_investigation?.priority && (
                      <Badge variant={s.latest_investigation.priority === 'P1' ? 'destructive' : 'secondary'} className="text-[10px]">
                        {s.latest_investigation.priority}
                      </Badge>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {tab === 'reports' && (
          <ul className="divide-y divide-border rounded-xl bg-card ring-1 ring-foreground/10">
            {services.filter((s) => s.latest_investigation).length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">Reports appear here after an investigation runs.</li>
            )}
            {services
              .filter((s) => s.latest_investigation)
              .map((s) => (
                <li key={s.slug} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className="flex-1 font-medium">{s.name}</span>
                  <Link href={`/investigations/${s.latest_investigation!.id}`} className={buttonVariants({ size: 'sm', variant: 'ghost' })}>
                    Investigation
                  </Link>
                  <a
                    href={`/api/investigations/${s.latest_investigation!.id}/ticket`}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({ size: 'sm', variant: 'outline' })}
                  >
                    CISO ticket
                  </a>
                </li>
              ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3.5 text-sm sm:px-5">
        <span className="font-medium">{services.length} city services monitored</span>
        {(['ok', 'at-risk', 'critical'] as const).map((s) => (
          <span key={s} className="flex items-center gap-2">
            <span className={cn('h-3 w-3 rounded-[3px]', STATUS_BG[s])} aria-hidden />
            <span key={counts[s]} className={cn('animate-in font-bold tabular-nums fade-in-0 zoom-in-75 duration-300', STATUS_TEXT[s])}>
              {counts[s]}
            </span>
            <span className="text-muted-foreground">{STATUS_LABEL[s]}</span>
          </span>
        ))}
        {flagged === 0 && <span className="ml-auto text-xs text-muted-foreground">Inventory is simulated</span>}
        {footer}
      </div>
    </div>
  );
}
