'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ServiceSummary, InjectResponse } from '@/lib/api-types';
import { computeServiceStatus, STATUS_LABEL, type ServiceStatus } from '@/lib/status';

const STATUS_DOT_CLASS: Record<ServiceStatus, string> = {
  ok: 'bg-status-ok',
  'at-risk': 'bg-status-at-risk',
  critical: 'bg-status-critical',
};

const STATUS_BORDER_CLASS: Record<ServiceStatus, string> = {
  ok: 'border-border',
  'at-risk': 'border-status-at-risk/60',
  critical: 'border-status-critical/70',
};

function ServiceCard({ service, hero }: { service: ServiceSummary; hero?: boolean }) {
  const status = computeServiceStatus(service.latest_investigation);
  const router = useRouter();
  const inv = service.latest_investigation;

  return (
    <Card
      className={`${STATUS_BORDER_CLASS[status]} ${hero ? 'border-2' : 'border'} ${
        inv ? 'cursor-pointer transition-colors hover:bg-accent/40' : ''
      }`}
      onClick={() => inv && router.push(`/investigations/${inv.id}`)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className={hero ? 'text-xl' : 'text-base'}>{service.name}</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">{service.department}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {service.criticality === 'life-safety' && (
              <Badge variant="destructive" className="text-[10px] tracking-wide">
                LIFE-SAFETY
              </Badge>
            )}
            <div className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT_CLASS[status]}`} />
              <span className="text-xs text-muted-foreground">{STATUS_LABEL[status]}</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {inv ? (
          <div className="flex items-center gap-2 text-sm">
            {inv.priority && (
              <Badge variant={inv.priority === 'P1' ? 'destructive' : 'secondary'}>{inv.priority}</Badge>
            )}
            {inv.risk_score !== null && (
              <span className="text-muted-foreground">Risk {inv.risk_score}/100</span>
            )}
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground capitalize">{inv.status}</span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{service.resident_impact}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function ReadinessBoard() {
  const [services, setServices] = useState<ServiceSummary[] | null>(null);
  const [injecting, setInjecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/services');
      const data = await res.json();
      if (res.ok) setServices(data.services);
    } catch {
      // Transient fetch failure during polling — keep showing the last
      // known state rather than clearing the board.
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  async function handleInject() {
    setInjecting(true);
    setError(null);
    try {
      const res = await fetch('/api/demo/inject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data: InjectResponse | { error: string } = await res.json();
      if (!res.ok || 'error' in data) {
        throw new Error('error' in data ? data.error : 'inject failed');
      }
      router.push(`/investigations/${data.investigation_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setInjecting(false);
    }
  }

  const nineOneOne = services?.find((s) => s.criticality === 'life-safety');
  const others = services?.filter((s) => s.criticality !== 'life-safety') ?? [];

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Detroit Cyber Ready</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Know when your city is at risk — before an incident becomes an outage.
          </p>
          <p className="mt-3 text-xs font-medium tracking-wide text-primary">
            DETECT&nbsp;&nbsp;→&nbsp;&nbsp;INVESTIGATE&nbsp;&nbsp;→&nbsp;&nbsp;ACT
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Badge variant="outline" className="text-muted-foreground">
            Simulated Inventory
          </Badge>
          <Button onClick={handleInject} disabled={injecting}>
            {injecting ? 'Injecting signal…' : 'Inject Demo Threat Signal'}
          </Button>
          {error && <p className="max-w-xs text-right text-xs text-destructive">{error}</p>}
        </div>
      </header>

      {!services && <p className="text-sm text-muted-foreground">Loading city services…</p>}

      {nineOneOne && (
        <section className="mb-6">
          <ServiceCard service={nineOneOne} hero />
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {others.map((s) => (
          <ServiceCard key={s.slug} service={s} />
        ))}
      </section>

      <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
        <span>{services?.length ?? 0} city services monitored</span>
        <a href="/signals" className="underline-offset-2 hover:underline">
          Threat intelligence feed →
        </a>
      </footer>
    </main>
  );
}
