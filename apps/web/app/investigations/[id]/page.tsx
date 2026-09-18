'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { BlastRadiusPanel } from '@/components/blast-radius';
import { RiskBars } from '@/components/risk-bars';
import type { ActionItem, DependencyInfo, RiskComponents, StepEvent } from '@/lib/api-types';

interface InvestigationDetail {
  investigation: {
    id: string;
    status: string;
    priority: 'P1' | 'P2' | 'P3' | 'informational' | null;
    risk_score: number | null;
    risk_components: RiskComponents | null;
    escalated: boolean;
    escalation_reason: string | null;
    output: string | null;
    context: { match: { landedOn: string; landedKind: 'service' | 'infrastructure'; hops: 0 | 1; dependency: DependencyInfo | null } } | null;
  };
  actions: ActionItem[];
  signal: { external_id: string; title: string; vendor_project: string | null; product: string | null; provenance: string } | null;
  service: { name: string; department: string; resident_impact: string; impact_unit: string | null } | null;
  other_affected_services: string[];
}

const STEP_LABELS: Record<string, string> = {
  connected: 'Connected',
  'context-assembled': 'Context assembled',
  'context-enriched': 'Checking Casky platform',
  'technique-assessed': 'Assessing exposure',
  'skills-selected': 'Selecting response skills',
  'impact-correlated': 'Correlating service impact',
  'plan-generated': 'Action plan generated',
};

const STALE_TIMEOUT_MS = 3 * 60 * 1000;

export default function InvestigationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<InvestigationDetail | null>(null);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [narrative, setNarrative] = useState('');
  const [done, setDone] = useState(false);
  const [stale, setStale] = useState(false);
  const lastEventAt = useRef(Date.now());
  const narrativeRef = useRef<HTMLDivElement>(null);

  // The deterministic pieces (match, dependency, risk score) are already
  // known before the agent ever runs — fetch them immediately rather than
  // waiting for the SSE stream, so the blast radius panel appears at once.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/investigations/${id}`);
      if (!cancelled && res.ok) {
        const data = await res.json();
        setDetail(data);
        if (data.investigation.output) setNarrative(data.investigation.output);
        if (['completed', 'failed', 'stopped'].includes(data.investigation.status)) setDone(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (done) return;
    const es = new EventSource(`/api/investigations/${id}/stream`);

    es.addEventListener('step', (e) => {
      lastEventAt.current = Date.now();
      setSteps((prev) => [...prev, JSON.parse(e.data)]);
    });
    es.onmessage = (e) => {
      lastEventAt.current = Date.now();
      const { text } = JSON.parse(e.data);
      setNarrative((prev) => prev + text);
    };
    es.addEventListener('done', () => {
      setDone(true);
      es.close();
      fetch(`/api/investigations/${id}`)
        .then((r) => r.json())
        .then(setDetail);
    });
    es.addEventListener('timeout', () => {
      setDone(true);
      es.close();
    });
    es.onerror = () => {
      // The browser's EventSource retries on its own; this just prevents a
      // console error spiral if the connection genuinely can't be
      // established. The stale banner below is the real escape hatch.
    };

    return () => es.close();
  }, [id, done]);

  // L5 guard: if no event has arrived in a while and we're not done, tell
  // the viewer rather than leaving a silently stalled spinner on screen.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!done && Date.now() - lastEventAt.current > STALE_TIMEOUT_MS) setStale(true);
    }, 5000);
    return () => clearInterval(interval);
  }, [done]);

  useEffect(() => {
    narrativeRef.current?.scrollTo({ top: narrativeRef.current.scrollHeight });
  }, [narrative]);

  if (!detail) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-sm text-muted-foreground">Loading investigation…</p>
      </main>
    );
  }

  const { investigation, service, signal, actions, other_affected_services } = detail;
  const match = investigation.context?.match;
  const visibleNarrative = narrative.split(/\n\n---\n\n/)[0];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <Link href="/" className="text-xs text-muted-foreground hover:underline">
        ← City readiness board
      </Link>

      <header className="mt-2 mb-6 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">{service?.name ?? investigation.id}</h1>
        {investigation.priority && (
          <Badge variant={investigation.priority === 'P1' ? 'destructive' : 'secondary'}>
            {investigation.priority}
          </Badge>
        )}
        {investigation.escalated && <Badge variant="destructive">Escalated</Badge>}
        <Badge variant="outline" className="capitalize text-muted-foreground">
          {investigation.status}
        </Badge>
      </header>

      {signal && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Signal</CardTitle>
              <Badge variant={signal.provenance === 'live' ? 'default' : 'outline'} className="text-[10px]">
                {signal.provenance === 'live' ? 'Live threat intelligence' : 'Simulated'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="font-medium">{signal.external_id}</p>
            <p className="text-muted-foreground">{signal.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {signal.vendor_project} / {signal.product}
            </p>
          </CardContent>
        </Card>
      )}

      {match && service && (
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">Exposure path</h2>
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              Detroit inventory: simulated
            </Badge>
          </div>
          <BlastRadiusPanel
            landedOn={match.landedOn}
            landedKind={match.landedKind}
            serviceName={service.name}
            hops={match.hops}
            dependency={match.dependency}
            otherAffectedServices={other_affected_services}
          />
        </div>
      )}

      {investigation.risk_components && investigation.risk_score !== null && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Risk assessment</CardTitle>
          </CardHeader>
          <CardContent>
            <RiskBars components={investigation.risk_components} score={investigation.risk_score} />
            {investigation.escalated && investigation.escalation_reason && (
              <p className="mt-3 rounded-md bg-status-critical/10 p-3 text-sm text-status-critical">
                {investigation.escalation_reason}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {service && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Resident impact</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {service.resident_impact}
            {service.impact_unit && <p className="mt-1 text-xs italic">Measured in: {service.impact_unit}</p>}
          </CardContent>
        </Card>
      )}

      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Live investigation</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="mb-3 space-y-1.5">
            {steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span className="text-muted-foreground">{STEP_LABELS[s.step] ?? s.step}</span>
              </li>
            ))}
            {!done && steps.length > 0 && (
              <li className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                Working…
              </li>
            )}
          </ol>

          {stale && !done && (
            <p className="mb-3 rounded-md bg-status-at-risk/10 p-2 text-xs text-status-at-risk">
              This investigation is taking longer than expected. It will still complete — the heal process
              recovers any run that loses its connection.
            </p>
          )}

          {visibleNarrative && (
            <div ref={narrativeRef} className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md bg-secondary/50 p-3 text-sm leading-relaxed">
              {visibleNarrative}
            </div>
          )}
        </CardContent>
      </Card>

      {actions.length > 0 && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Recommended actions</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {actions.map((a) => (
                <li key={a.rank} className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                      {a.rank}
                    </span>
                    <span className="font-medium">{a.title}</span>
                    <Badge variant="outline" className="ml-auto text-[10px]">
                      {a.sla}
                    </Badge>
                  </div>
                  <p className="ml-7 mt-0.5 text-muted-foreground">
                    {a.detail} <span className="text-xs">— {a.owner}</span>
                  </p>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {done && (
        <div className="flex flex-wrap gap-2">
          <a href={`/api/investigations/${id}/ticket`} target="_blank" rel="noreferrer">
            <Button variant="secondary">View CISO alert / incident ticket</Button>
          </a>
        </div>
      )}

      <Separator className="my-6" />
      <p className="text-xs text-muted-foreground">
        The exposure match above is deterministic and auditable. The narrative and action plan were generated
        by an AI assistant from that match. Detroit&apos;s technology inventory in this demo is simulated.
      </p>
    </main>
  );
}
