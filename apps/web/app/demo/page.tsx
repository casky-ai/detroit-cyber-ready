'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { cn } from 'cn';
import {
  Bell,
  Bot,
  CircleCheck,
  CircleX,
  Loader2,
  Play,
  Radar,
  Search,
  Send,
  Siren,
  Wrench,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LiveClock, nowStamp } from '@/components/live-clock';
import { PageContainer } from '@/components/page-header';
import type { AgentState, DemoStartResponse, TimelineEvent } from '@/lib/timeline-types';

// The fixed, known demo trigger. Its details are shown on the first screen
// before anything is injected. The real injection (and the five real
// investigation rows) only happens when "Inspect City Agencies for
// Readiness" is clicked, via POST /api/demo/start. Every fact shown here
// matches exactly what that endpoint injects; see its file header for the
// full provenance note (a real, currently-listed CISA KEV entry).
const KNOWN_SIGNAL = {
  external_id: 'CVE-2023-46805',
  title: 'Ivanti Connect Secure and Policy Secure Authentication Bypass Vulnerability',
  summary:
    'Ivanti Connect Secure (ICS) and Ivanti Policy Secure gateways contain an authentication bypass ' +
    'vulnerability in the web component, allowing an attacker to access restricted resources by ' +
    'bypassing control checks. CISA notes known ransomware campaign use.',
  cvss_score: 8.2,
  epss_percentile: 0.99983,
  vendor_project: 'Ivanti',
  product: 'Connect Secure',
};

type Phase = 'idle' | 'cve-reported' | 'inspecting' | 'summary' | 'alert-sent';

const PRIORITY_ORDER: Record<string, number> = { P1: 0, P2: 1, P3: 2, informational: 3 };

// Step events an agent emits before it completes (see STEP_LABELS on the
// investigation page); used only to size the per-agent progress bar.
const EXPECTED_STEPS = 7;

const STAGES: Array<{ label: string; icon: typeof Radar; reachedAt: Phase[] }> = [
  { label: 'Detect', icon: Radar, reachedAt: ['cve-reported', 'inspecting', 'summary', 'alert-sent'] },
  { label: 'Investigate', icon: Search, reachedAt: ['inspecting', 'summary', 'alert-sent'] },
  { label: 'Act', icon: Wrench, reachedAt: ['summary', 'alert-sent'] },
  { label: 'Alert', icon: Bell, reachedAt: ['alert-sent'] },
];

const EVENT_ICON: Record<TimelineEvent['kind'], typeof Radar> = {
  system: Radar,
  agent: Bot,
  alert: Send,
};

const EVENT_TONE: Record<TimelineEvent['kind'], string> = {
  system: 'bg-brand-verdigris/20 text-brand-verdigris',
  agent: 'bg-primary/15 text-brand-gold',
  alert: 'bg-status-at-risk/20 text-status-at-risk',
};

function PhaseStepper({ phase }: { phase: Phase }) {
  return (
    <ol className="mx-auto mb-8 flex max-w-xl items-center" aria-label="Demo progress">
      {STAGES.map(({ label, icon: Icon, reachedAt }, i) => {
        const reached = reachedAt.includes(phase);
        const current = reached && (i === STAGES.length - 1 || !STAGES[i + 1].reachedAt.includes(phase));
        return (
          <Fragment key={label}>
            {i > 0 && (
              <li aria-hidden className="mx-2 h-px flex-1 overflow-hidden bg-border">
                <span
                  className={cn(
                    'block h-full origin-left bg-brand-gold transition-transform duration-700 ease-out',
                    reached ? 'scale-x-100' : 'scale-x-0'
                  )}
                />
              </li>
            )}
            <li className="flex flex-col items-center gap-1.5" aria-current={current ? 'step' : undefined}>
              <span
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full ring-1 transition-all duration-500',
                  reached ? 'bg-primary text-primary-foreground ring-primary' : 'bg-muted text-muted-foreground ring-border',
                  current && 'shadow-[0_0_0_6px] shadow-primary/20'
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span
                className={cn(
                  'text-xs font-semibold transition-colors',
                  reached ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {label}
              </span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

function AgentCard({ agent }: { agent: AgentState }) {
  const { seed, phase, steps } = agent;
  const p1 = seed.risk.priority === 'P1';
  const pct = phase === 'completed' ? 100 : phase === 'failed' ? 100 : Math.min(92, Math.round((steps.length / EXPECTED_STEPS) * 100));
  const lastStep = steps[steps.length - 1];

  return (
    <Card size="sm" className={cn('transition-shadow duration-500', p1 && 'ring-status-critical/50')}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex min-w-0 items-center gap-2 text-sm">
            {phase === 'completed' ? (
              <CircleCheck className="h-4 w-4 shrink-0 text-status-ok" aria-hidden />
            ) : phase === 'failed' ? (
              <CircleX className="h-4 w-4 shrink-0 text-status-critical" aria-hidden />
            ) : (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-gold" aria-hidden />
            )}
            <span className="truncate">{seed.service_name}</span>
          </CardTitle>
          <Badge variant={p1 ? 'destructive' : 'secondary'} className="shrink-0 text-[10px]">
            {seed.risk.priority}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-700 ease-out',
              phase === 'failed' ? 'bg-status-critical' : phase === 'completed' ? 'bg-status-ok' : 'bg-brand-gold'
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span key={lastStep ?? phase} className="min-w-0 animate-in truncate fade-in-0 duration-300">
            {phase === 'completed'
              ? `Complete, ${agent.actions.length} actions`
              : phase === 'failed'
                ? 'Timed out'
                : (lastStep ?? 'Connecting')}
          </span>
          <span className="shrink-0 tabular-nums">Risk {seed.risk.score}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DemoPage() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [demoData, setDemoData] = useState<DemoStartResponse | null>(null);
  const [agents, setAgents] = useState<Record<string, AgentState>>({});
  const [alertResult, setAlertResult] = useState<{ sent: boolean; reason?: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const eventSourcesRef = useRef<EventSource[]>([]);

  function pushEvent(label: string, kind: TimelineEvent['kind'] = 'system') {
    setTimeline((prev) => [...prev, { time: nowStamp(), label, kind }]);
  }

  // Scroll only the timeline panel, never the page, so the presenter keeps
  // control of what the audience is looking at.
  useEffect(() => {
    const el = timelineScrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [timeline]);

  useEffect(() => {
    const sources = eventSourcesRef.current;
    return () => {
      sources.forEach((es) => es.close());
    };
  }, []);

  function handleStartDemo() {
    setPhase('cve-reported');
    pushEvent(`New external threat signal detected: ${KNOWN_SIGNAL.external_id}`, 'system');
  }

  async function handleInspect() {
    setStarting(true);
    pushEvent('Inspection started: gathering evidence, starting Casky investigations', 'system');
    try {
      const res = await fetch('/api/demo/start', { method: 'POST' });
      const data: DemoStartResponse | { error: string } = await res.json();
      if (!res.ok || 'error' in data) throw new Error('error' in data ? data.error : 'failed to start');

      setDemoData(data);
      pushEvent(
        `${data.investigations.length} parallel agents at work, inspecting ${data.investigations
          .map((i) => i.service_name)
          .join(', ')}`,
        'system'
      );

      const initialAgents: Record<string, AgentState> = {};
      for (const seed of data.investigations) {
        initialAgents[seed.investigation_id] = { seed, phase: 'queued', steps: [], narrative: '', actions: [] };
      }
      setAgents(initialAgents);
      setPhase('inspecting');

      for (const seed of data.investigations) {
        connectAgent(seed.investigation_id, seed.service_name);
      }
    } catch (err) {
      pushEvent(`Failed to start inspection: ${err instanceof Error ? err.message : String(err)}`, 'system');
      setStarting(false);
    }
  }

  function connectAgent(investigationId: string, serviceName: string) {
    const es = new EventSource(`/api/investigations/${investigationId}/stream`);
    eventSourcesRef.current.push(es);

    setAgents((prev) => ({ ...prev, [investigationId]: { ...prev[investigationId], phase: 'running' } }));
    pushEvent(`${serviceName}: agent connected, investigating`, 'agent');

    es.addEventListener('step', (e) => {
      const step = JSON.parse(e.data);
      setAgents((prev) => ({
        ...prev,
        [investigationId]: { ...prev[investigationId], steps: [...prev[investigationId].steps, step.label] },
      }));
    });
    es.onmessage = (e) => {
      const { text } = JSON.parse(e.data);
      setAgents((prev) => ({
        ...prev,
        [investigationId]: { ...prev[investigationId], narrative: prev[investigationId].narrative + text },
      }));
    };
    es.addEventListener('done', () => {
      es.close();
      pushEvent(`${serviceName}: investigation complete`, 'agent');
      fetch(`/api/investigations/${investigationId}`)
        .then((r) => r.json())
        .then((detail) => {
          setAgents((prev) => ({
            ...prev,
            [investigationId]: { ...prev[investigationId], phase: 'completed', actions: detail.actions ?? [] },
          }));
        });
    });
    es.addEventListener('timeout', () => {
      es.close();
      setAgents((prev) => ({ ...prev, [investigationId]: { ...prev[investigationId], phase: 'failed' } }));
      pushEvent(`${serviceName}: investigation timed out`, 'agent');
    });
  }

  // Advance to the summary once every agent has reached a terminal phase.
  useEffect(() => {
    if (phase !== 'inspecting') return;
    const list = Object.values(agents);
    if (list.length === 0) return;
    if (list.every((a) => a.phase === 'completed' || a.phase === 'failed')) {
      pushEvent('All agents reported: summary ready', 'system');
      setPhase('summary');
    }
  }, [agents, phase]);

  async function handleSendAlert() {
    if (!demoData) return;
    setSending(true);
    const investigationsSummary = Object.values(agents).map((a) => ({
      service_name: a.seed.service_name,
      priority: a.seed.risk.priority,
      risk_score: a.seed.risk.score,
      escalated: a.seed.risk.escalated,
    }));
    pushEvent('Sending alert to Slack', 'alert');
    try {
      const res = await fetch('/api/alerts/slack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signal: { ...demoData.signal, source: 'cisa-kev' }, timeline, investigations: investigationsSummary }),
      });
      const result = await res.json();
      setAlertResult(result);
      pushEvent(result.sent ? 'Alert delivered to Slack' : `Alert not delivered: ${result.reason}`, 'alert');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setAlertResult({ sent: false, reason });
      pushEvent(`Alert not delivered: ${reason}`, 'alert');
    }
    setSending(false);
    setPhase('alert-sent');
  }

  const sortedAgents = Object.values(agents).sort(
    (a, b) => PRIORITY_ORDER[a.seed.risk.priority] - PRIORITY_ORDER[b.seed.risk.priority]
  );
  const worst = sortedAgents[0];
  const totalActions = sortedAgents.reduce((sum, a) => sum + a.actions.length, 0);
  const finished = sortedAgents.filter((a) => a.phase === 'completed' || a.phase === 'failed').length;

  return (
    <PageContainer className="max-w-5xl">
      <div className="mb-6 flex flex-col items-center gap-1 text-center">
        <LiveClock />
        <p className="text-sm text-muted-foreground">Detroit time, live. Nothing on this screen is pre-recorded.</p>
      </div>

      <PhaseStepper phase={phase} />

      {phase === 'idle' && (
        <div className="flex animate-in flex-col items-center gap-5 py-10 fade-in-0 duration-500">
          <p className="max-w-md text-center text-sm text-pretty text-muted-foreground">
            A real vulnerability from the CISA catalog arrives. Watch Detroit Cyber Ready find which city services it
            reaches, investigate each one, and alert the CISO in Slack.
          </p>
          <Button size="lg" onClick={handleStartDemo} className="h-11 gap-2 px-6 text-base font-semibold">
            <Play className="h-4 w-4 fill-current" aria-hidden />
            Start the demo
          </Button>
        </div>
      )}

      <div className="space-y-4">
        {phase !== 'idle' && (
          <Card className="animate-in ring-status-critical/50 fade-in-0 slide-in-from-bottom-2 duration-500">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Siren className="h-4 w-4 text-status-critical" aria-hidden />
                  New exploited vulnerability reported by CISA
                </CardTitle>
                <Badge variant="destructive" className="tabular-nums">
                  {KNOWN_SIGNAL.external_id}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p className="font-medium text-pretty">{KNOWN_SIGNAL.title}</p>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  ['Source', 'CISA Known Exploited Vulnerabilities catalog'],
                  [
                    'Details',
                    `${KNOWN_SIGNAL.vendor_project} ${KNOWN_SIGNAL.product}, CVSS ${KNOWN_SIGNAL.cvss_score}, exploitation likelier than ${(KNOWN_SIGNAL.epss_percentile * 100).toFixed(1)}% of all known CVEs (EPSS)`,
                  ],
                  ['Impact', 'Potentially reaches city services via shared remote-access infrastructure'],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-muted/60 p-3">
                    <dt className="text-xs font-medium text-muted-foreground">{k}</dt>
                    <dd className="mt-1 text-pretty">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-pretty text-muted-foreground">{KNOWN_SIGNAL.summary}</p>

              {phase === 'cve-reported' && (
                <Button onClick={handleInspect} disabled={starting} size="lg" className="gap-2 font-semibold">
                  {starting ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Search className="h-4 w-4" aria-hidden />
                  )}
                  {starting ? 'Starting agents' : 'Inspect City Agencies for Readiness'}
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {sortedAgents.length > 0 && (
          <section className="animate-in fade-in-0 duration-500">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <Bot className="h-4 w-4" aria-hidden />
                Five agents inspecting in parallel
              </h2>
              <span className="tabular-nums text-xs tabular-nums text-muted-foreground">
                {finished} of {sortedAgents.length} reported
              </span>
            </div>
            <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sortedAgents.map((a) => (
                <AgentCard key={a.seed.investigation_id} agent={a} />
              ))}
            </div>
          </section>
        )}

        {(phase === 'summary' || phase === 'alert-sent') && worst && (
          <Card className="animate-in fade-in-0 slide-in-from-bottom-2 duration-500">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Wrench className="h-4 w-4 text-brand-gold" aria-hidden />
                What Detroit should do now
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-muted/60 p-3">
                  <p className="tabular-nums text-2xl font-semibold tabular-nums">{sortedAgents.length}</p>
                  <p className="text-xs text-muted-foreground">Services inspected</p>
                </div>
                <div className="rounded-lg bg-status-critical/10 p-3">
                  <p className="tabular-nums text-2xl font-semibold text-status-critical">{worst.seed.risk.priority}</p>
                  <p className="truncate text-xs text-muted-foreground">Worst: {worst.seed.service_name}</p>
                </div>
                <div className="rounded-lg bg-muted/60 p-3">
                  <p className="tabular-nums text-2xl font-semibold tabular-nums">{totalActions}</p>
                  <p className="text-xs text-muted-foreground">Action items</p>
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-semibold text-muted-foreground">
                  Remediation plan, most urgent service first
                </p>
                <ol className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                  {sortedAgents.flatMap((a) =>
                    a.actions.map((action) => (
                      <li
                        key={`${a.seed.investigation_id}-${action.rank}`}
                        className="flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50"
                      >
                        <span className="mt-0.5 w-28 shrink-0 truncate text-xs text-muted-foreground">
                          {a.seed.service_name}
                        </span>
                        <span className="min-w-0 flex-1 text-pretty">{action.title}</span>
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          {action.sla}
                        </Badge>
                      </li>
                    ))
                  )}
                </ol>
              </div>
              {phase === 'summary' && (
                <Button onClick={handleSendAlert} disabled={sending} size="lg" className="gap-2 font-semibold">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                  {sending ? 'Sending alert' : 'Send Message / Alert'}
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {phase === 'alert-sent' && alertResult && (
          <Card
            className={cn(
              'animate-in fade-in-0 zoom-in-95 duration-500',
              alertResult.sent ? 'ring-status-ok/50' : 'ring-status-at-risk/50'
            )}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {alertResult.sent ? (
                  <CircleCheck className="h-5 w-5 text-status-ok" aria-hidden />
                ) : (
                  <Bell className="h-5 w-5 text-status-at-risk" aria-hidden />
                )}
                {alertResult.sent ? 'Alert delivered to Slack' : 'Alert preview (Slack not yet connected)'}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {alertResult.sent
                ? 'The full forensics and timeline were posted to the configured Slack channel.'
                : alertResult.reason}
            </CardContent>
          </Card>
        )}

        {timeline.length > 0 && (
          <Card className="animate-in fade-in-0 duration-500">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-muted-foreground">
                  What happened, and when
                </CardTitle>
                <span className="tabular-nums text-xs tabular-nums text-muted-foreground">{timeline.length} events</span>
              </div>
            </CardHeader>
            <CardContent>
              <div ref={timelineScrollRef} className="max-h-80 overflow-y-auto pr-1">
                <ol className="relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-[11px] before:w-px before:bg-border">
                  {timeline.map((e, i) => {
                    const Icon = EVENT_ICON[e.kind];
                    return (
                      <li
                        key={i}
                        className="relative flex animate-in items-start gap-3 fade-in-0 slide-in-from-bottom-1 duration-300"
                      >
                        <span
                          className={cn(
                            'relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-4 ring-card',
                            EVENT_TONE[e.kind]
                          )}
                        >
                          <Icon className="h-3 w-3" aria-hidden />
                        </span>
                        <div className="min-w-0 pt-0.5">
                          <span className="mr-2 tabular-nums text-xs tabular-nums text-muted-foreground">{e.time}</span>
                          <span className={cn('text-sm text-pretty', e.kind === 'alert' && 'text-status-at-risk')}>
                            {e.label}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
