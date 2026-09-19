'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { cn } from 'cn';
import { ChevronRight, CircleCheck, FileText, Loader2, TriangleAlert, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { BlastRadiusPanel } from '@/components/blast-radius';
import { RiskBars } from '@/components/risk-bars';
import { PageContainer } from '@/components/page-header';
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <CardTitle className="text-sm font-semibold text-muted-foreground">{children}</CardTitle>;
}

function LoadingSkeleton() {
  return (
    <PageContainer className="max-w-4xl">
      <Skeleton className="mb-3 h-4 w-40" />
      <Skeleton className="mb-6 h-9 w-72" />
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-36 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    </PageContainer>
  );
}

export default function InvestigationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<InvestigationDetail | null>(null);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [narrative, setNarrative] = useState('');
  const [done, setDone] = useState(false);
  const [stale, setStale] = useState(false);
  // Set when the stream opens; read by the stale-banner interval below.
  const lastEventAt = useRef(0);
  const narrativeRef = useRef<HTMLDivElement>(null);

  // The deterministic pieces (match, dependency, risk score) are already
  // known before the agent ever runs; fetch them immediately rather than
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
    lastEventAt.current = Date.now();
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
    narrativeRef.current?.scrollTo({ top: narrativeRef.current.scrollHeight, behavior: 'smooth' });
  }, [narrative]);

  if (!detail) return <LoadingSkeleton />;

  const { investigation, service, signal, actions, other_affected_services } = detail;
  const match = investigation.context?.match;
  const visibleNarrative = narrative.split(/\n\n---\n\n/)[0];

  return (
    <PageContainer className="max-w-4xl">
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1 text-xs text-muted-foreground">
        <Link href="/history" className="transition-colors hover:text-foreground">
          History
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden />
        <span className="truncate text-foreground">{service?.name ?? 'Investigation'}</span>
      </nav>

      <header className="mb-6 flex flex-wrap items-center gap-2">
        <h1 className="mr-1 text-2xl font-semibold tracking-tight sm:text-3xl">{service?.name ?? investigation.id}</h1>
        {investigation.priority && (
          <Badge variant={investigation.priority === 'P1' ? 'destructive' : 'secondary'}>{investigation.priority}</Badge>
        )}
        {investigation.escalated && (
          <Badge variant="outline" className="text-brand-gold">
            Escalated
          </Badge>
        )}
        <Badge variant="outline" className="gap-1.5 capitalize text-muted-foreground">
          {!done && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          {done ? investigation.status : 'running'}
        </Badge>
        {service && <p className="w-full text-sm text-muted-foreground">{service.department}</p>}
      </header>

      <div className="space-y-4">
        {signal && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <SectionTitle>Signal</SectionTitle>
                <Badge variant={signal.provenance === 'live' ? 'default' : 'outline'} className="text-[10px]">
                  {signal.provenance === 'live' ? 'Live threat intelligence' : 'Simulated'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="text-sm">
              <p className="tabular-nums font-medium">{signal.external_id}</p>
              <p className="mt-0.5 text-pretty text-muted-foreground">{signal.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {signal.vendor_project} / {signal.product}
              </p>
            </CardContent>
          </Card>
        )}

        {match && service && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground">Exposure path</h2>
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
          </section>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {investigation.risk_components && investigation.risk_score !== null && (
            <Card>
              <CardHeader>
                <SectionTitle>Risk assessment</SectionTitle>
              </CardHeader>
              <CardContent>
                <RiskBars components={investigation.risk_components} score={investigation.risk_score} />
                {investigation.escalated && investigation.escalation_reason && (
                  <p className="mt-3 rounded-lg bg-status-critical/10 p-3 text-sm text-pretty text-status-critical">
                    {investigation.escalation_reason}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {service && (
            <Card>
              <CardHeader>
                <SectionTitle>Resident impact</SectionTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p className="flex gap-2 text-pretty">
                  <Users className="mt-0.5 h-4 w-4 shrink-0 text-brand-gold" aria-hidden />
                  {service.resident_impact}
                </p>
                {service.impact_unit && (
                  <p className="mt-2 text-xs text-muted-foreground">Measured in: {service.impact_unit}</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader>
            <SectionTitle>Live investigation</SectionTitle>
          </CardHeader>
          <CardContent>
            {steps.length > 0 && (
              <ol className="mb-3 space-y-1.5">
                {steps.map((s, i) => (
                  <li key={i} className="flex animate-in items-center gap-2 text-sm fade-in-0 slide-in-from-left-1 duration-300">
                    <CircleCheck className="h-4 w-4 shrink-0 text-status-ok" aria-hidden />
                    <span className="text-muted-foreground">{STEP_LABELS[s.step] ?? s.step}</span>
                  </li>
                ))}
                {!done && (
                  <li className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-gold" aria-hidden />
                    Working
                  </li>
                )}
              </ol>
            )}
            {steps.length === 0 && !done && (
              <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-brand-gold" aria-hidden />
                Connecting to the investigation agent
              </p>
            )}

            {stale && !done && (
              <p className="mb-3 flex gap-2 rounded-lg bg-status-at-risk/10 p-2.5 text-xs text-status-at-risk">
                <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
                This investigation is taking longer than expected. It will still complete: the heal process recovers
                any run that loses its connection.
              </p>
            )}

            {visibleNarrative && (
              <div
                ref={narrativeRef}
                className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg bg-secondary/60 p-3.5 text-sm leading-relaxed text-pretty"
              >
                {visibleNarrative}
                {!done && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-brand-gold align-middle" />}
              </div>
            )}
          </CardContent>
        </Card>

        {actions.length > 0 && (
          <Card>
            <CardHeader>
              <SectionTitle>Recommended actions</SectionTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {actions.map((a) => (
                  <li key={a.rank} className="text-sm">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary tabular-nums text-[11px] font-semibold text-primary-foreground">
                        {a.rank}
                      </span>
                      <span className="font-medium">{a.title}</span>
                      <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
                        {a.sla}
                      </Badge>
                    </div>
                    <p className="ml-8.5 mt-1 text-pretty text-muted-foreground">
                      {a.detail} <span className="text-xs">({a.owner})</span>
                    </p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        )}

        {done && (
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/investigations/${id}/ticket`}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: 'secondary' }), 'gap-1.5')}
            >
              <FileText className="h-4 w-4" aria-hidden />
              View CISO alert / incident ticket
            </a>
          </div>
        )}
      </div>

      <p className="mt-8 border-t border-border pt-4 text-xs text-pretty text-muted-foreground">
        The exposure match above is deterministic and auditable. The narrative and action plan were generated by an AI
        assistant from that match. Detroit&apos;s technology inventory in this demo is simulated.
      </p>
    </PageContainer>
  );
}
