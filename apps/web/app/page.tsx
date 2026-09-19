'use client';

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ServiceSummary } from '@/lib/api-types';
import { computeServiceStatus, STATUS_LABEL, type ServiceStatus } from '@/lib/status';

// MapLibre touches window/DOM at import time — load it client-only.
const DetroitMap = dynamic(() => import('@/components/detroit-map').then((m) => m.DetroitMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] w-full items-center justify-center rounded-lg border border-border text-sm text-muted-foreground sm:h-[520px]">
      Loading map…
    </div>
  ),
});

interface AssetInfo {
  service: { slug: string; name: string; address: string };
  own_technology: Array<{ vendor: string; product: string; version: string | null; exposure: string }>;
  shared_infrastructure: Array<{
    infrastructure_name: string;
    criticality: 'hard' | 'soft';
    rationale: string;
    technology: Array<{ vendor: string; product: string; version: string | null; exposure: string }>;
  }>;
}

const STATUS_DOT_CLASS: Record<ServiceStatus, string> = {
  ok: 'bg-status-ok',
  'at-risk': 'bg-status-at-risk',
  critical: 'bg-status-critical',
};

interface FeedSignal {
  id: string;
  source: string;
  provenance: 'live' | 'synthetic';
  external_id: string;
  title: string;
  published_at: string;
  matches: Array<{ service_slug: string }>;
}

export default function ReadinessBoard() {
  const [services, setServices] = useState<ServiceSummary[] | null>(null);
  const [selected, setSelected] = useState<ServiceSummary | null>(null);
  const [assets, setAssets] = useState<AssetInfo | null>(null);
  const [signals, setSignals] = useState<FeedSignal[] | null>(null);
  const [investigating, setInvestigating] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const [servicesRes, signalsRes] = await Promise.all([fetch('/api/services'), fetch('/api/signals?limit=8')]);
      if (servicesRes.ok) setServices((await servicesRes.json()).services);
      if (signalsRes.ok) setSignals((await signalsRes.json()).signals);
    } catch {
      // Transient fetch failure during polling — keep the last known state.
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  async function handleSelect(service: ServiceSummary) {
    setSelected(service);
    setAssets(null);
    const res = await fetch(`/api/services/${service.slug}/assets`);
    if (res.ok) setAssets(await res.json());
  }

  async function handleInvestigateNow() {
    if (!selected?.latest_investigation) return;
    router.push(`/investigations/${selected.latest_investigation.id}`);
  }

  const liveSignals = signals?.filter((s) => s.provenance === 'live') ?? [];
  const criticalCount = services?.filter((s) => computeServiceStatus(s.latest_investigation) === 'critical').length ?? 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-brand-verdigris" aria-hidden />
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Detroit Cyber Ready</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Know when your city is at risk — before an incident becomes an outage.
          </p>
          <p className="mt-2 text-xs font-medium tracking-wide text-brand-gold">
            DETECT&nbsp;&nbsp;→&nbsp;&nbsp;INVESTIGATE&nbsp;&nbsp;→&nbsp;&nbsp;ACT
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Badge variant="outline" className="text-muted-foreground">
            Simulated Inventory
          </Badge>
          <div className="flex gap-2">
            <Link href="/history">
              <Button variant="outline" size="sm">
                History
              </Button>
            </Link>
            <Link href="/signals">
              <Button variant="outline" size="sm">
                Threat Feed
              </Button>
            </Link>
            <Link href="/demo">
              <Button size="sm" className="font-semibold">
                Start Demo
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span>{services?.length ?? 0} city services monitored</span>
        <span>·</span>
        <span className={criticalCount > 0 ? 'text-status-critical' : ''}>
          {criticalCount} at critical priority
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {services && <DetroitMap services={services} onSelect={handleSelect} />}
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-status-ok" /> Operational
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-status-at-risk" /> At Risk
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-status-critical" /> Critical
            </span>
            <span className="ml-auto">White ring = life-safety tier</span>
          </div>
        </div>

        <div>
          {!selected && (
            <Card className="flex h-full min-h-[200px] items-center justify-center text-center">
              <CardContent className="pt-6 text-sm text-muted-foreground">
                Click a marker on the map to see that service&apos;s status, address, and declared assets.
              </CardContent>
            </Card>
          )}
          {selected && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{selected.name}</CardTitle>
                    <p className="mt-0.5 text-xs text-muted-foreground">{selected.department}</p>
                  </div>
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT_CLASS[computeServiceStatus(selected.latest_investigation)]}`}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-xs text-muted-foreground">{selected.address}</p>
                <p>{selected.resident_impact}</p>

                {selected.latest_investigation && (
                  <div className="flex items-center gap-2">
                    {selected.latest_investigation.priority && (
                      <Badge variant={selected.latest_investigation.priority === 'P1' ? 'destructive' : 'secondary'}>
                        {selected.latest_investigation.priority}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground capitalize">
                      {selected.latest_investigation.status}
                    </span>
                    <Button size="sm" variant="outline" className="ml-auto" onClick={handleInvestigateNow}>
                      View investigation
                    </Button>
                  </div>
                )}

                <div className="border-t border-border pt-3">
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Declared assets
                  </p>
                  {!assets && <p className="text-xs text-muted-foreground">Loading…</p>}
                  {assets && (
                    <div className="space-y-2 text-xs">
                      {assets.own_technology.map((t, i) => (
                        <div key={i} className="rounded border border-border p-2">
                          <p className="font-medium">
                            {t.vendor} {t.product} {t.version && `(${t.version})`}
                          </p>
                          <p className="text-muted-foreground">{t.exposure}</p>
                        </div>
                      ))}
                      {assets.shared_infrastructure.map((dep, i) => (
                        <div key={i} className="rounded border border-border p-2">
                          <p className="font-medium">
                            via {dep.infrastructure_name}{' '}
                            <Badge variant={dep.criticality === 'hard' ? 'destructive' : 'outline'} className="text-[9px]">
                              {dep.criticality}
                            </Badge>
                          </p>
                          {dep.technology.map((t, j) => (
                            <p key={j} className="text-muted-foreground">
                              {t.vendor} {t.product} {t.version && `(${t.version})`} — {t.exposure}
                            </p>
                          ))}
                        </div>
                      ))}
                      {assets.own_technology.length === 0 && assets.shared_infrastructure.length === 0 && (
                        <p className="text-muted-foreground">No declared technology on file.</p>
                      )}
                    </div>
                  )}
                  <p className="mt-2 text-[10px] italic text-muted-foreground">
                    Declared inventory, not a live scan — see docs/connectors.md.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Live CISA KEV Feed</CardTitle>
              <Badge className="text-[10px]">Real, live</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {liveSignals.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No signals polled yet. See <code>packages/signals/src/sources/cisa-kev.ts</code> — this panel reads
                directly from the <code>signals</code> table that route populates.
              </p>
            )}
            <div className="space-y-2">
              {liveSignals.slice(0, 5).map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-muted-foreground">{s.external_id}</span>
                  <span className="truncate">{s.title}</span>
                  {s.matches.length > 0 && (
                    <Badge variant="outline" className="ml-auto shrink-0 text-[9px] text-status-at-risk">
                      {s.matches.length} match{s.matches.length === 1 ? '' : 'es'}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
            <Link href="/signals" className="mt-2 inline-block text-xs text-muted-foreground hover:underline">
              View full feed →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Threat Intelligence Context</CardTitle>
              <Badge variant="outline" className="text-[10px]">
                Simulated
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Synthetic scanning/OSINT-style indicators, stored the same way live signals are. Not fetched from a
            live scanner — see the <code>SurfaceSource</code> contract in <code>packages/signals</code>.
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
