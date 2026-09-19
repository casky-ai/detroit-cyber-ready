'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from 'cn';
import { ArrowRight, Bot, CircleCheck, ClipboardList, ExternalLink, Loader2, Radar, ShieldAlert, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CityBoard, statusSummary, type BoardSignal } from '@/components/city-board';
import type { BasemapLoad } from '@/components/city-map';
import { ActionPlanCard, ImpactCard, type InvestigationDetail } from '@/components/impact-card';
import { PageContainer } from '@/components/page-header';
import { ResetDemoButton } from '@/components/reset-demo-button';
import type { ServiceSummary, StepEvent } from '@/lib/api-types';
import type { DemoInvestigationSeed, DemoStartResponse } from '@/lib/timeline-types';

// The main dashboard, told as the six-step story the demo walks through:
// 1 all clear, 2 threat intel arrives, 3 agents investigate, 4 risk
// identified, 5 impact analysis, 6 action plan delivered. Every step runs
// the real pipeline: the signal is a real CISA KEV entry and step 3 opens
// one live agent per affected service.

const DETROIT = 'America/Detroit';
const ANCHOR_SLUG = '911-emergency-communications';

const clock = (d: Date | string = new Date()) =>
  new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: DETROIT });
const clockSeconds = (d: Date | string) =>
  new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: DETROIT });

// The agent's real step events, in the order it emits them.
const STEPS: Array<{ key: string; label: string }> = [
  { key: 'connected', label: 'Pick up the threat signal' },
  { key: 'context-assembled', label: 'Analyze threat intelligence and indicators' },
  { key: 'context-enriched', label: 'Check the Casky platform for known playbooks' },
  { key: 'technique-assessed', label: 'Assess the exploitation technique and exposure' },
  { key: 'skills-selected', label: 'Select response skills' },
  { key: 'impact-correlated', label: 'Correlate with city services and resident impact' },
  { key: 'plan-generated', label: 'Generate the remediation plan' },
];

const SIGNAL = {
  cve: 'CVE-2023-46805',
  product: 'Ivanti Connect Secure',
  summary:
    'Actively exploited authentication bypass in Ivanti Connect Secure, a widely used remote access gateway.',
  added: 'Jan 10, 2024',
  kevUrl: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
};

// What else is known about this CVE. Everything marked live comes from the
// real feeds; the scanning item is illustrative until a GreyNoise-style
// source is connected (see docs/connectors.md), and says so.
const RELATED: Array<{ text: string; source: string; live: boolean }> = [
  { text: 'Known use in ransomware campaigns', source: 'CISA KEV', live: true },
  { text: 'Exploitation likelier than 99.98% of published CVEs', source: 'FIRST EPSS', live: true },
  { text: 'Authentication bypass, CWE-287, CVSS 8.2', source: 'NVD', live: true },
  { text: 'Increased scanning of remote access gateways', source: 'Scanning intel', live: false },
];

type Step = 1 | 2 | 3 | 4 | 5 | 6;

interface AgentRun {
  seed: DemoInvestigationSeed;
  state: 'running' | 'done' | 'failed';
  steps: Record<string, string>;
}

function StoryStep({
  n,
  time,
  title,
  description,
  children,
  tone = 'default',
}: {
  n: number;
  time: string;
  title: string;
  description: ReactNode;
  children: ReactNode;
  tone?: 'default' | 'alert';
}) {
  return (
    <section className="grid animate-in grid-cols-[auto_1fr] gap-x-4 gap-y-4 fade-in-0 slide-in-from-bottom-3 duration-500 sm:gap-x-6">
      <span
        className={cn(
          'flex h-11 w-11 items-center justify-center rounded-full text-lg font-extrabold sm:h-14 sm:w-14 sm:text-2xl',
          tone === 'alert' ? 'bg-status-critical text-white' : 'bg-primary text-primary-foreground'
        )}
      >
        {n}
      </span>
      <div>
        <p className="text-lg font-bold tabular-nums text-brand-gold sm:text-xl" suppressHydrationWarning>
          {time}
        </p>
        <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h2>
        <p className="mt-1 max-w-[62ch] text-[15px] text-pretty text-muted-foreground">{description}</p>
      </div>
      <div className="col-span-2 sm:col-start-2 sm:col-span-1">{children}</div>
    </section>
  );
}

export default function ReadinessStory() {
  const [services, setServices] = useState<ServiceSummary[] | null>(null);
  const [signals, setSignals] = useState<BoardSignal[] | null>(null);
  const [mapLoad, setMapLoad] = useState<BasemapLoad>({ state: 'loading' });
  const [times, setTimes] = useState<Partial<Record<Step, string>>>(() => ({ 1: clock() }));
  const [phase, setPhase] = useState<Step>(1);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoStartResponse | null>(null);
  const [agents, setAgents] = useState<Record<string, AgentRun>>({});
  const [detail, setDetail] = useState<InvestigationDetail | null>(null);
  const [alert, setAlert] = useState<{ state: 'idle' | 'sending' | 'sent' | 'not-sent'; reason?: string }>({ state: 'idle' });
  const sources = useRef<EventSource[]>([]);
  const stepRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const load = useCallback(async () => {
    try {
      const [s, g] = await Promise.all([fetch('/api/services'), fetch('/api/signals?limit=6')]);
      if (s.ok) setServices((await s.json()).services);
      if (g.ok) setSignals((await g.json()).signals);
    } catch {
      // keep last known state
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(load, 5000);
    const open = sources.current;
    return () => {
      clearTimeout(first);
      clearInterval(id);
      open.forEach((es) => es.close());
    };
  }, [load]);

  // A reload is the cleanest restart: open agent streams close, every step
  // unmounts, and step 1 re-reads the now empty board.
  function restart() {
    window.location.reload();
  }

  function reach(step: Exclude<Step, 1>) {
    setTimes((t) => ({ ...t, [step]: clock() }));
    setPhase(step);
    // Let the new step mount, then bring it into view for the audience.
    setTimeout(() => stepRefs.current[step]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  async function investigate() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch('/api/demo/start', { method: 'POST' });
      const data: DemoStartResponse | { error: string } = await res.json();
      if (!res.ok || 'error' in data) throw new Error('error' in data ? data.error : `status ${res.status}`);
      setDemo(data);
      const initial: Record<string, AgentRun> = {};
      for (const seed of data.investigations) initial[seed.investigation_id] = { seed, state: 'running', steps: {} };
      setAgents(initial);
      reach(3);
      for (const seed of data.investigations) connect(seed.investigation_id);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  function connect(id: string) {
    const es = new EventSource(`/api/investigations/${id}/stream`);
    sources.current.push(es);
    es.addEventListener('step', (e) => {
      const step: StepEvent = JSON.parse(e.data);
      setAgents((prev) => ({ ...prev, [id]: { ...prev[id], steps: { ...prev[id].steps, [step.step]: step.at } } }));
    });
    es.addEventListener('done', () => {
      es.close();
      setAgents((prev) => ({ ...prev, [id]: { ...prev[id], state: 'done' } }));
    });
    es.addEventListener('timeout', () => {
      es.close();
      setAgents((prev) => ({ ...prev, [id]: { ...prev[id], state: 'failed' } }));
    });
  }

  // Step 4 arrives when every agent has reported, with the board refreshed
  // so the pins show the new status.
  useEffect(() => {
    const list = Object.values(agents);
    if (phase !== 3 || list.length === 0 || list.some((a) => a.state === 'running')) return;
    const anchorRun = list.find((a) => a.seed.service_slug === ANCHOR_SLUG) ?? list[0];
    Promise.resolve().then(() => Promise.all([
      load(),
      fetch(`/api/investigations/${anchorRun.seed.investigation_id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then(setDetail)
        .catch(() => undefined),
    ])).then(() => reach(4));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, phase]);

  async function sendAlert() {
    if (!demo) return;
    setAlert({ state: 'sending' });
    try {
      const res = await fetch('/api/alerts/slack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The server reads everything else from the stored investigations.
        body: JSON.stringify({ investigation_ids: demo.investigations.map((s) => s.investigation_id) }),
      });
      const result = await res.json();
      setAlert(result.sent ? { state: 'sent' } : { state: 'not-sent', reason: result.reason });
    } catch (err) {
      setAlert({ state: 'not-sent', reason: err instanceof Error ? err.message : String(err) });
    }
  }

  const summary = services ? statusSummary(services) : null;
  const agentList = Object.values(agents).sort((a, b) => (a.seed.service_slug === ANCHOR_SLUG ? -1 : b.seed.service_slug === ANCHOR_SLUG ? 1 : 0));
  const anchor = agentList.find((a) => a.seed.service_slug === ANCHOR_SLUG) ?? agentList[0];
  const currentStep = anchor ? STEPS.findIndex((s) => !anchor.steps[s.key]) : -1;

  return (
    <PageContainer className="max-w-5xl space-y-14 pb-24">
      <div>
        <div className="flex flex-wrap items-end justify-between gap-6 border-b border-border pb-8">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">Detroit Cyber Ready</h1>
            <p className="mt-2 text-lg text-muted-foreground">Know when your city is at risk, before an incident becomes an outage.</p>
          </div>
          <div className="text-right">
            <p className="flex items-center justify-end gap-3 text-2xl font-extrabold tracking-wide text-brand-gold">
              Detect <ArrowRight className="h-5 w-5" aria-hidden /> Investigate <ArrowRight className="h-5 w-5" aria-hidden /> Act
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              External intelligence + AI agents + service impact = a more resilient Detroit
            </p>
          </div>
        </div>
      </div>

      {/* Step 1: the board, all clear (or showing whatever is live). */}
      <div ref={(el) => { stepRefs.current[1] = el; }}>
        <StoryStep
          n={1}
          time={times[1] ?? ''}
          title={summary ? (summary.flagged === 0 ? 'All systems operational' : `${summary.headline}`) : 'Checking city services'}
          description={
            summary && summary.flagged > 0
              ? 'Results from an earlier run are still on the board. Reset the demo to start the story from all green.'
              : 'Detroit city services are healthy and online.'
          }
        >
          {services ? (
            <CityBoard services={services} signals={signals} onBasemapLoad={setMapLoad} />
          ) : (
            <div className="aspect-[1000/700] animate-pulse rounded-2xl bg-muted" />
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {mapLoad.state === 'ready'
              ? `Street map loaded from this site in ${mapLoad.ms} ms (${mapLoad.kb} KB). No external map service is used, so it works on any network.`
              : mapLoad.state === 'error'
                ? 'Street map failed to load from /maps/detroit-basemap.svg.'
                : 'Loading the street map from this site.'}
          </p>
          {phase === 1 && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button size="lg" className="gap-2 font-semibold" onClick={() => reach(2)}>
                <Radar className="h-4 w-4" aria-hidden />
                Receive a new threat signal
              </Button>
              {summary && summary.flagged > 0 && <ResetDemoButton size="lg" onDone={restart} />}
            </div>
          )}
        </StoryStep>
      </div>

      {/* Step 2: a real KEV entry arrives. */}
      {phase >= 2 && (
        <div ref={(el) => { stepRefs.current[2] = el; }}>
          <StoryStep
            n={2}
            time={times[2] ?? ''}
            title="New threat intel detected"
            description="A high-priority external threat intelligence alert arrives."
          >
            <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
              <div className="flex items-center gap-2 px-5 pt-4 text-base font-semibold">
                <ShieldAlert className="h-5 w-5 text-status-critical" aria-hidden />
                Threat intelligence feed
              </div>
              <div className="m-4 rounded-xl bg-status-critical/10 p-4 ring-1 ring-status-critical/30">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="destructive" className="font-bold">
                    New threat alert
                  </Badge>
                  <span className="text-sm tabular-nums text-muted-foreground">{times[2]}</span>
                </div>
                <p className="mt-3 text-sm font-medium text-sky-300">CISA Known Exploited Vulnerabilities (KEV)</p>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-2xl font-extrabold tabular-nums">{SIGNAL.cve}</p>
                  <Badge variant="destructive">High priority</Badge>
                </div>
                <p className="mt-1.5 text-pretty">{SIGNAL.summary}</p>
                <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                  <a href={SIGNAL.kevUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-300 hover:underline">
                    Source: CISA KEV <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                  <span>Added to the KEV catalog {SIGNAL.added}</span>
                </div>
              </div>
              <div className="px-5 pb-2">
                <p className="text-sm font-semibold">Related intelligence</p>
                <ul className="mt-2 divide-y divide-border/60">
                  {RELATED.map((r) => (
                    <li key={r.text} className="flex items-center gap-3 py-2.5 text-sm">
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', r.live ? 'bg-status-critical' : 'bg-muted-foreground')} aria-hidden />
                      <span className="min-w-0 flex-1">{r.text}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{r.source}</span>
                      <Badge variant="outline" className="w-20 shrink-0 justify-center text-[10px]">
                        {r.live ? 'Live data' : 'Simulated'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
              {phase === 2 && (
                <div className="p-4">
                  <Button
                    size="lg"
                    onClick={investigate}
                    disabled={starting}
                    className="h-12 w-full gap-2 text-base font-semibold"
                  >
                    {starting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Bot className="h-5 w-5" aria-hidden />}
                    {starting ? 'Starting agents' : 'Investigate with Casky agents'}
                  </Button>
                  {startError && <p className="mt-2 text-sm text-status-critical">Could not start the investigation: {startError}</p>}
                </div>
              )}
            </div>
          </StoryStep>
        </div>
      )}

      {/* Step 3: the real agents, one per affected service. */}
      {phase >= 3 && anchor && (
        <div ref={(el) => { stepRefs.current[3] = el; }}>
          <StoryStep
            n={3}
            time={times[3] ?? ''}
            title="Casky agents start investigating"
            description="Agents analyze the threat, map it to Detroit's services, and gather evidence."
          >
            <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
              <div className="flex items-center gap-3 px-5 pt-5">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-brand-gold ring-1 ring-primary/40">
                  <Bot className="h-6 w-6" aria-hidden />
                </span>
                <div className="flex-1">
                  <p className="text-base font-bold">Casky agent investigation</p>
                  <p className="text-sm text-sky-300">Investigating {SIGNAL.cve} for {anchor.seed.service_name}</p>
                </div>
                <span className="text-sm tabular-nums text-muted-foreground">{times[3]}</span>
              </div>

              <ol className="relative mx-5 mt-4 space-y-3 before:absolute before:top-3 before:bottom-3 before:left-[11px] before:w-px before:bg-border">
                {STEPS.map((s, i) => {
                  const at = anchor.steps[s.key];
                  const current = !at && i === currentStep && anchor.state === 'running';
                  return (
                    <li key={s.key} className="relative flex items-center gap-3 text-sm">
                      <span
                        className={cn(
                          'relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-4 ring-card transition-colors duration-300',
                          at ? 'bg-status-ok text-background' : current ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {at ? (
                          <CircleCheck className="h-4 w-4" aria-hidden />
                        ) : current ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        )}
                      </span>
                      <span className="w-14 shrink-0 text-muted-foreground">Step {i + 1}</span>
                      <span className={cn('min-w-0 flex-1', current && 'font-semibold text-brand-gold', !at && !current && 'text-muted-foreground')}>
                        {s.label}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{at ? clockSeconds(at) : current ? 'Working' : 'Pending'}</span>
                    </li>
                  );
                })}
              </ol>

              <div className="m-4 rounded-xl bg-muted/50 p-4">
                <p className="text-sm font-semibold">Agents at work</p>
                <p className="text-xs text-muted-foreground">One agent per city service the vulnerability reaches, running in parallel.</p>
                <div className="stagger mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {agentList.map((a) => (
                    <div key={a.seed.investigation_id} className="flex flex-col items-center gap-1.5 rounded-lg bg-card p-3 text-center ring-1 ring-foreground/10">
                      <span
                        className={cn(
                          'flex h-9 w-9 items-center justify-center rounded-full',
                          a.state === 'done' ? 'bg-status-ok/15 text-status-ok' : a.state === 'failed' ? 'bg-status-critical/15 text-status-critical' : 'bg-primary/15 text-brand-gold'
                        )}
                      >
                        {a.state === 'running' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CircleCheck className="h-4 w-4" aria-hidden />}
                      </span>
                      <span className="text-xs font-semibold leading-tight">{a.seed.service_name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {a.state === 'running' ? `${Object.keys(a.steps).length} of ${STEPS.length} steps` : a.state === 'done' ? 'Reported' : 'Timed out'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </StoryStep>
        </div>
      )}

      {/* Step 4: the same board, now showing where the risk landed. */}
      {phase >= 4 && services && anchor && (
        <div ref={(el) => { stepRefs.current[4] = el; }}>
          <StoryStep
            n={4}
            tone="alert"
            time={times[4] ?? ''}
            title="Risk identified"
            description={
              anchor.seed.dependency
                ? `Casky traced ${SIGNAL.cve} to ${anchor.seed.dependency.infrastructure.replace(/-/g, ' ')} infrastructure, one hop from ${anchor.seed.service_name}.`
                : `Casky found an exposed asset associated with ${anchor.seed.service_name}.`
            }
          >
            <CityBoard services={services} signals={signals} calloutSlug={ANCHOR_SLUG} />
            {phase === 4 && detail && (
              <Button size="lg" className="mt-5 gap-2 font-semibold" onClick={() => reach(5)}>
                <Users className="h-4 w-4" aria-hidden />
                Show the impact on residents
              </Button>
            )}
          </StoryStep>
        </div>
      )}
      {/* Step 5: what it means for residents, from the stored investigation. */}
      {phase >= 5 && detail && anchor && (
        <div ref={(el) => { stepRefs.current[5] = el; }}>
          <StoryStep
            n={5}
            tone="alert"
            time={times[5] ?? ''}
            title="Impact analysis"
            description="Casky determines the potential impact on residents."
          >
            <ImpactCard
              detail={detail}
              timeline={[
                { time: times[1] ?? '', label: 'Board checked: services online' },
                { time: times[2] ?? '', label: `${SIGNAL.cve} received from CISA KEV` },
                ...STEPS.filter((st) => anchor.steps[st.key]).map((st) => ({ time: clockSeconds(anchor.steps[st.key]), label: st.label })),
                { time: times[4] ?? '', label: `Risk identified for ${anchor.seed.service_name}` },
              ]}
            />
            {phase === 5 && (
              <Button size="lg" className="mt-5 gap-2 font-semibold" onClick={() => reach(6)}>
                <ClipboardList className="h-4 w-4" aria-hidden />
                Deliver the action plan
              </Button>
            )}
          </StoryStep>
        </div>
      )}

      {/* Step 6: the agent's ranked plan, the ticket, and the CISO alert. */}
      {phase >= 6 && detail && (
        <div ref={(el) => { stepRefs.current[6] = el; }}>
          <StoryStep
            n={6}
            time={times[6] ?? ''}
            title="Action plan delivered"
            description="Casky provides clear, prioritized next steps for the CISO and team."
          >
            <ActionPlanCard detail={detail} alertState={alert.state} alertReason={alert.reason} onSendAlert={sendAlert} />
          </StoryStep>
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6 text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">Detroit Cyber Ready</span>
        <span>Proactive intelligence. Stronger services. A more resilient Detroit.</span>
        <span>Built for Detroit, powered by Casky</span>
        <span className="flex w-full justify-end">
          <ResetDemoButton onDone={restart} />
        </span>
      </footer>
    </PageContainer>
  );
}
