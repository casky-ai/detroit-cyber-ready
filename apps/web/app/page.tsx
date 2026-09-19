'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { cn } from 'cn';
import { Activity, MapPin, MousePointerClick, Radar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DetroitMap } from '@/components/detroit-map';
import { PageContainer } from '@/components/page-header';
import type { ServiceSummary } from '@/lib/api-types';
import { computeServiceStatus, STATUS_LABEL, type ServiceStatus } from '@/lib/status';

interface Tech {
  vendor: string;
  product: string;
  version: string | null;
  exposure: string;
}

interface AssetInfo {
  service: { slug: string; name: string; address: string };
  own_technology: Tech[];
  shared_infrastructure: Array<{
    infrastructure_name: string;
    criticality: 'hard' | 'soft';
    rationale: string;
    technology: Tech[];
  }>;
}

interface FeedSignal {
  id: string;
  source: string;
  provenance: 'live' | 'synthetic';
  external_id: string;
  title: string;
  published_at: string;
  matches: Array<{ service_slug: string }>;
}

const STATUS_DOT: Record<ServiceStatus, string> = {
  ok: 'bg-status-ok',
  'at-risk': 'bg-status-at-risk',
  critical: 'bg-status-critical',
};

const STATUS_TEXT: Record<ServiceStatus, string> = {
  ok: 'text-status-ok',
  'at-risk': 'text-status-at-risk',
  critical: 'text-status-critical',
};

function breakdown(critical: number, atRisk: number): string {
  const parts = [critical > 0 && `${critical} at critical priority`, atRisk > 0 && `${atRisk} at risk`].filter(Boolean);
  return parts.length ? `${parts.join(' and ')}. ` : '';
}

const CRITICALITY_ORDER: Record<ServiceSummary['criticality'], number> = {
  'life-safety': 0,
  critical: 1,
  high: 2,
  moderate: 3,
  low: 4,
};

// The page's headline is the city's status, stated as a sentence a CISO
// could read aloud, not a title plus a row of counters.
function statusHeadline(services: ServiceSummary[]): string {
  const flagged = services.filter((s) => computeServiceStatus(s.latest_investigation) !== 'ok').length;
  if (flagged === 0) return `All ${services.length} city services are operational.`;
  if (flagged === services.length) return `All ${services.length} city services need attention.`;
  return `${flagged} of ${services.length} city services need attention.`;
}

// One cell per service, most critical first. Doubles as a compact legend
// and as a second way to open a service without hunting on the map.
function ServiceStrip({
  services,
  selectedSlug,
  onSelect,
}: {
  services: ServiceSummary[];
  selectedSlug?: string;
  onSelect: (s: ServiceSummary) => void;
}) {
  const ordered = [...services].sort((a, b) => CRITICALITY_ORDER[a.criticality] - CRITICALITY_ORDER[b.criticality]);
  return (
    <div className="flex gap-1" role="list" aria-label="Service status, most critical first">
      {ordered.map((s) => {
        const status = computeServiceStatus(s.latest_investigation);
        return (
          <button
            key={s.slug}
            role="listitem"
            title={`${s.name}: ${STATUS_LABEL[status]}`}
            aria-label={`${s.name}, ${STATUS_LABEL[status]}`}
            onClick={() => onSelect(s)}
            className={cn(
              'h-2.5 flex-1 rounded-[3px] outline-none transition-[opacity,transform] duration-200 hover:scale-y-150 focus-visible:ring-2 focus-visible:ring-ring',
              STATUS_DOT[status],
              selectedSlug && selectedSlug !== s.slug && 'opacity-45'
            )}
          />
        );
      })}
    </div>
  );
}

function TechRow({ t }: { t: Tech }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5">
      <span className="font-medium text-foreground">
        {t.vendor} {t.product}
      </span>
      {t.version && <span className="tabular-nums text-[11px] text-muted-foreground">{t.version}</span>}
      <span className="text-muted-foreground">({t.exposure})</span>
    </p>
  );
}

export default function ReadinessBoard() {
  const [services, setServices] = useState<ServiceSummary[] | null>(null);
  const [selected, setSelected] = useState<ServiceSummary | null>(null);
  const [assets, setAssets] = useState<AssetInfo | null>(null);
  const [signals, setSignals] = useState<FeedSignal[] | null>(null);

  const load = useCallback(async () => {
    try {
      const [servicesRes, signalsRes] = await Promise.all([fetch('/api/services'), fetch('/api/signals?limit=8')]);
      if (servicesRes.ok) {
        const next: ServiceSummary[] = (await servicesRes.json()).services;
        setServices(next);
        // Keep the side panel in step with the 5s poll, so a marker that
        // turns critical also turns critical in the open detail card.
        setSelected((prev) => (prev ? (next.find((s) => s.slug === prev.slug) ?? prev) : prev));
      }
      if (signalsRes.ok) setSignals((await signalsRes.json()).signals);
    } catch {
      // Transient fetch failure during polling: keep the last known state.
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  async function handleSelect(service: ServiceSummary) {
    if (service.slug === selected?.slug) return;
    setSelected(service);
    setAssets(null);
    try {
      const res = await fetch(`/api/services/${service.slug}/assets`);
      if (res.ok) setAssets(await res.json());
    } catch {
      // Leave the skeleton; the viewer can click again.
    }
  }

  const liveSignals = signals?.filter((s) => s.provenance === 'live') ?? [];
  const count = (status: ServiceStatus) =>
    services ? services.filter((s) => computeServiceStatus(s.latest_investigation) === status).length : null;
  const selectedStatus = selected ? computeServiceStatus(selected.latest_investigation) : null;

  return (
    <PageContainer>
      <section className="mb-7 max-w-3xl">
        {services ? (
          <h1 className="text-[2.25rem] font-extrabold leading-[1.05] tracking-[-0.025em] text-balance sm:text-[3.25rem]">
            {statusHeadline(services)}
          </h1>
        ) : (
          <Skeleton className="h-12 w-full max-w-xl sm:h-14" />
        )}
        <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-muted-foreground text-pretty">
          {services && breakdown(count('critical') ?? 0, count('at-risk') ?? 0)}
          Every marker is a city service at its real address. Select one to see what it runs and what it depends on.
        </p>
        <div className="mt-5 max-w-md">
          {services ? (
            <ServiceStrip services={services} selectedSlug={selected?.slug} onSelect={handleSelect} />
          ) : (
            <Skeleton className="h-2.5 w-full" />
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {services ? (
            <DetroitMap services={services} selectedSlug={selected?.slug} onSelect={handleSelect} />
          ) : (
            <Skeleton className="aspect-[1000/640] w-full rounded-xl" />
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {(['ok', 'at-risk', 'critical'] as const).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[s])} /> {STATUS_LABEL[s]}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-foreground" /> Life-safety tier
            </span>
            <span className="sm:ml-auto">Service inventory is simulated</span>
          </div>
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          {!selected ? (
            <Card className="justify-center py-8 lg:min-h-[240px]">
              <CardContent className="flex flex-col items-center gap-3 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                  <MousePointerClick className="h-5 w-5 text-muted-foreground" aria-hidden />
                </span>
                <p className="max-w-[240px] text-sm text-muted-foreground">
                  Select a marker on the map to see that service&apos;s status, address, and declared assets.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card key={selected.slug} className="animate-in fade-in-0 slide-in-from-right-2 duration-300">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base">{selected.name}</CardTitle>
                    <p className="mt-0.5 text-xs text-muted-foreground">{selected.department}</p>
                  </div>
                  {selectedStatus && (
                    <Badge variant="outline" className={cn('shrink-0 gap-1.5', STATUS_TEXT[selectedStatus])}>
                      <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[selectedStatus])} />
                      {STATUS_LABEL[selectedStatus]}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {selected.address}
                </p>
                <p className="text-pretty">{selected.resident_impact}</p>

                {selected.latest_investigation && (
                  <div className="flex items-center gap-2 rounded-lg bg-muted/60 p-2.5">
                    {selected.latest_investigation.priority && (
                      <Badge variant={selected.latest_investigation.priority === 'P1' ? 'destructive' : 'secondary'}>
                        {selected.latest_investigation.priority}
                      </Badge>
                    )}
                    <span className="text-xs capitalize text-muted-foreground">
                      {selected.latest_investigation.status}
                    </span>
                    <Link
                      href={`/investigations/${selected.latest_investigation.id}`}
                      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'ml-auto')}
                    >
                      Open investigation
                    </Link>
                  </div>
                )}

                <div className="border-t border-border pt-3">
                  <p className="mb-2 text-sm font-semibold text-muted-foreground">
                    Declared assets
                  </p>
                  {!assets ? (
                    <div className="space-y-2">
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  ) : (
                    <div className="space-y-2 text-xs">
                      {assets.own_technology.map((t, i) => (
                        <div key={i} className="rounded-lg border border-border p-2.5">
                          <TechRow t={t} />
                        </div>
                      ))}
                      {assets.shared_infrastructure.map((dep, i) => (
                        <div key={i} className="space-y-1 rounded-lg border border-border p-2.5">
                          <p className="flex items-center gap-1.5 text-muted-foreground">
                            via <span className="font-medium text-foreground">{dep.infrastructure_name}</span>
                            <Badge
                              variant={dep.criticality === 'hard' ? 'destructive' : 'outline'}
                              className="h-4 px-1.5 text-[10px]"
                            >
                              {dep.criticality}
                            </Badge>
                          </p>
                          {dep.technology.map((t, j) => (
                            <TechRow key={j} t={t} />
                          ))}
                        </div>
                      ))}
                      {assets.own_technology.length === 0 && assets.shared_infrastructure.length === 0 && (
                        <p className="text-muted-foreground">No declared technology on file.</p>
                      )}
                    </div>
                  )}
                  <p className="mt-2.5 text-[11px] text-muted-foreground">
                    Declared inventory, not a live scan. See docs/connectors.md.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Radar className="h-4 w-4 text-brand-gold" aria-hidden />
                Live CISA KEV feed
              </CardTitle>
              <Badge className="gap-1.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-foreground/70" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary-foreground" />
                </span>
                Live
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {!signals ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-5 w-full" />
                ))}
              </div>
            ) : liveSignals.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No signals polled yet. The poll cron writes the <code>signals</code> table this
                panel reads from.
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {liveSignals.slice(0, 5).map((s) => (
                  <li key={s.id} className="flex items-center gap-3 py-2 text-xs first:pt-0 last:pb-0">
                    <span className="w-32 shrink-0 tabular-nums text-muted-foreground">{s.external_id}</span>
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    {s.matches.length > 0 ? (
                      <Badge variant="outline" className="shrink-0 text-[10px] text-status-at-risk">
                        {s.matches.length} match{s.matches.length === 1 ? '' : 'es'}
                      </Badge>
                    ) : (
                      <span className="shrink-0 text-[10px] text-muted-foreground">No exposure</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/signals"
              className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              See the full threat feed
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Activity className="h-4 w-4 text-brand-verdigris" aria-hidden />
                Threat intelligence context
              </CardTitle>
              <Badge variant="outline" className="text-[10px]">
                Simulated
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="text-xs text-pretty text-muted-foreground">
            Synthetic scanning and OSINT-style indicators, stored the same way live signals are. Not fetched from a
            live scanner; see the <code>SurfaceSource</code> contract in{' '}
            <code>packages/signals</code>.
          </CardContent>
        </Card>
      </section>
    </PageContainer>
  );
}
