'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { cn } from 'cn';
import { Activity, ArrowRight, Building2, MapPin, MousePointerClick, Radar, ShieldAlert, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DetroitMap } from '@/components/detroit-map';
import { PageContainer, PageHeader } from '@/components/page-header';
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

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Activity;
  label: string;
  value: number | null;
  tone?: string;
}) {
  return (
    <Card size="sm" className="gap-1">
      <CardContent className="flex items-center gap-3">
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg bg-muted', tone)}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          {value === null ? (
            <Skeleton className="mb-1 h-6 w-8" />
          ) : (
            <p className={cn('font-mono text-2xl font-semibold tabular-nums leading-none', tone)}>{value}</p>
          )}
          <p className="mt-1 truncate text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function TechRow({ t }: { t: Tech }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5">
      <span className="font-medium text-foreground">
        {t.vendor} {t.product}
      </span>
      {t.version && <span className="font-mono text-[11px] text-muted-foreground">{t.version}</span>}
      <span className="text-muted-foreground">· {t.exposure}</span>
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
      <PageHeader
        eyebrow="City readiness board"
        title="Is Detroit ready right now?"
        description="Know when your city is at risk, before an incident becomes an outage. Every marker is a city service at its real address."
        actions={
          <Badge variant="outline" className="gap-1.5 text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-status-at-risk" aria-hidden />
            Simulated inventory
          </Badge>
        }
      />

      <div className="stagger mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Building2} label="City services monitored" value={services?.length ?? null} />
        <StatCard icon={ShieldAlert} label="Critical priority" value={count('critical')} tone="text-status-critical" />
        <StatCard icon={TriangleAlert} label="At risk" value={count('at-risk')} tone="text-status-at-risk" />
        <StatCard icon={ShieldCheck} label="Operational" value={count('ok')} tone="text-status-ok" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {services ? (
            <DetroitMap services={services} selectedSlug={selected?.slug} onSelect={handleSelect} />
          ) : (
            <Skeleton className="h-[420px] w-full rounded-xl sm:h-[520px]" />
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {(['ok', 'at-risk', 'critical'] as const).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[s])} /> {STATUS_LABEL[s]}
              </span>
            ))}
            <span className="flex items-center gap-1.5 sm:ml-auto">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-white" /> Life-safety tier
            </span>
          </div>
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          {!selected ? (
            <Card className="min-h-[240px] justify-center">
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
                      Open investigation <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  </div>
                )}

                <div className="border-t border-border pt-3">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Declared assets
                  </p>
                  {!assets ? (
                    <div className="space-y-2">
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  ) : (
                    <div className="stagger space-y-2 text-xs">
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
                No signals polled yet. The poll cron writes the <code className="font-mono">signals</code> table this
                panel reads from.
              </p>
            ) : (
              <ul className="stagger divide-y divide-border/60">
                {liveSignals.slice(0, 5).map((s) => (
                  <li key={s.id} className="flex items-center gap-3 py-2 text-xs first:pt-0 last:pb-0">
                    <span className="w-32 shrink-0 font-mono text-muted-foreground">{s.external_id}</span>
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
              View full feed <ArrowRight className="h-3 w-3" aria-hidden />
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
            live scanner; see the <code className="font-mono">SurfaceSource</code> contract in{' '}
            <code className="font-mono">packages/signals</code>.
          </CardContent>
        </Card>
      </section>
    </PageContainer>
  );
}
