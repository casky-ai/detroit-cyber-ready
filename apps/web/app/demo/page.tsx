'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LiveClock, nowStamp } from '@/components/live-clock';
import type { AgentState, DemoStartResponse, TimelineEvent } from '@/lib/timeline-types';

// The fixed, known demo trigger — its details are shown on the first screen
// before anything is injected. The real injection (and the five real
// investigation rows) only happens when "Inspect City Agencies for
// Readiness" is clicked, via POST /api/demo/start. Every fact shown here
// matches exactly what that endpoint injects — see its file header for the
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

export default function DemoPage() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [demoData, setDemoData] = useState<DemoStartResponse | null>(null);
  const [agents, setAgents] = useState<Record<string, AgentState>>({});
  const [alertResult, setAlertResult] = useState<{ sent: boolean; reason?: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const timelineEndRef = useRef<HTMLDivElement>(null);
  const eventSourcesRef = useRef<EventSource[]>([]);

  function pushEvent(label: string, kind: TimelineEvent['kind'] = 'system') {
    setTimeline((prev) => [...prev, { time: nowStamp(), label, kind }]);
  }

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [timeline]);

  useEffect(() => {
    return () => {
      eventSourcesRef.current.forEach((es) => es.close());
    };
  }, []);

  function handleStartDemo() {
    setPhase('cve-reported');
    pushEvent(`New external threat signal detected: ${KNOWN_SIGNAL.external_id}`, 'system');
  }

  async function handleInspect() {
    setStarting(true);
    pushEvent('Inspection started — gathering evidence, starting Casky investigations', 'system');
    try {
      const res = await fetch('/api/demo/start', { method: 'POST' });
      const data: DemoStartResponse | { error: string } = await res.json();
      if (!res.ok || 'error' in data) throw new Error('error' in data ? data.error : 'failed to start');

      setDemoData(data);
      pushEvent(
        `${data.investigations.length} parallel agents at work — inspecting ${data.investigations
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
      pushEvent('All agents reported — summary ready', 'system');
      setPhase('summary');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, phase]);

  async function handleSendAlert() {
    if (!demoData) return;
    const investigationsSummary = Object.values(agents).map((a) => ({
      service_name: a.seed.service_name,
      priority: a.seed.risk.priority,
      risk_score: a.seed.risk.score,
      escalated: a.seed.risk.escalated,
    }));
    pushEvent('Sending alert to Slack…', 'alert');
    const res = await fetch('/api/alerts/slack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signal: { ...demoData.signal, source: 'cisa-kev' }, timeline, investigations: investigationsSummary }),
    });
    const result = await res.json();
    setAlertResult(result);
    pushEvent(result.sent ? 'Alert delivered to Slack' : `Alert not delivered: ${result.reason}`, 'alert');
    setPhase('alert-sent');
  }

  const sortedAgents = Object.values(agents).sort(
    (a, b) => PRIORITY_ORDER[a.seed.risk.priority] - PRIORITY_ORDER[b.seed.risk.priority]
  );
  const worst = sortedAgents[0];
  const totalActions = sortedAgents.reduce((sum, a) => sum + a.actions.length, 0);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <Link href="/" className="text-xs text-muted-foreground hover:underline">
        ← City readiness board
      </Link>

      <div className="my-6 flex flex-col items-center gap-2 text-center">
        <LiveClock />
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Detroit Cyber Ready — Live Timeline</p>
      </div>

      {phase === 'idle' && (
        <div className="flex flex-col items-center gap-4 py-12">
          <p className="max-w-md text-center text-sm text-muted-foreground">
            Simulates a new external threat signal arriving and Detroit Cyber Ready responding to it in real time.
          </p>
          <Button size="lg" onClick={handleStartDemo}>
            Start Demo
          </Button>
        </div>
      )}

      {phase !== 'idle' && (
        <Card className="mb-4 border-status-critical/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">CVE Reported — Source: CISA KEV</CardTitle>
              <Badge variant="destructive">{KNOWN_SIGNAL.external_id}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-medium">{KNOWN_SIGNAL.title}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase text-muted-foreground">Source</p>
                <p>CISA Known Exploited Vulnerabilities catalog</p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Details</p>
                <p>
                  {KNOWN_SIGNAL.vendor_project} / {KNOWN_SIGNAL.product} · CVSS {KNOWN_SIGNAL.cvss_score} · EPSS{' '}
                  {(KNOWN_SIGNAL.epss_percentile * 100).toFixed(1)}th pct
                </p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Impact</p>
                <p>Potentially reaches city services via shared remote-access infrastructure</p>
              </div>
            </div>
            <p className="pt-1 text-muted-foreground">{KNOWN_SIGNAL.summary}</p>

            {phase === 'cve-reported' && (
              <div className="pt-3">
                <Button onClick={handleInspect} disabled={starting}>
                  {starting ? 'Starting…' : 'Inspect City Agencies for Readiness'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(phase === 'inspecting' || phase === 'summary' || phase === 'alert-sent') && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sortedAgents.map((a) => (
            <Card key={a.seed.investigation_id} className={a.seed.risk.priority === 'P1' ? 'border-status-critical/60' : ''}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">{a.seed.service_name}</CardTitle>
                  <Badge variant={a.seed.risk.priority === 'P1' ? 'destructive' : 'secondary'} className="text-[10px]">
                    {a.seed.risk.priority}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="mb-1 text-xs text-muted-foreground">
                  {a.phase === 'completed' ? '✓ Complete' : a.phase === 'failed' ? '✕ Timed out' : '● Working…'} ·
                  Risk {a.seed.risk.score}/100
                </p>
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {a.steps.slice(-3).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {(phase === 'summary' || phase === 'alert-sent') && worst && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Investigation Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              <strong>{sortedAgents.length} services inspected</strong>, worst priority{' '}
              <Badge variant="destructive">{worst.seed.risk.priority}</Badge> ({worst.seed.service_name}, risk{' '}
              {worst.seed.risk.score}/100). <strong>{totalActions} total action items</strong> generated across all
              agencies.
            </p>
            <div>
              <p className="mb-1 font-medium">Remediation plan</p>
              <ol className="list-decimal space-y-1 pl-5">
                {sortedAgents.flatMap((a) =>
                  a.actions.map((action) => (
                    <li key={`${a.seed.investigation_id}-${action.rank}`}>
                      <span className="text-muted-foreground">[{a.seed.service_name}]</span> {action.title} —{' '}
                      <Badge variant="outline" className="text-[10px]">
                        {action.sla}
                      </Badge>
                    </li>
                  ))
                )}
              </ol>
            </div>
            {phase === 'summary' && <Button onClick={handleSendAlert}>Send Message / Alert</Button>}
          </CardContent>
        </Card>
      )}

      {phase === 'alert-sent' && alertResult && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {alertResult.sent ? '✓ Alert delivered to Slack' : 'Alert preview (Slack not yet connected)'}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {alertResult.sent
              ? 'The full forensics and timeline were posted to the configured Slack channel.'
              : alertResult.reason}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-64 space-y-1.5 overflow-y-auto text-sm">
            {timeline.map((e, i) => (
              <div key={i} className="flex gap-3">
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{e.time}</span>
                <span className={e.kind === 'alert' ? 'text-status-at-risk' : ''}>{e.label}</span>
              </div>
            ))}
            <div ref={timelineEndRef} />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
