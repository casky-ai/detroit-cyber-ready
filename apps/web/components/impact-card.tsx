'use client';

import { useState } from 'react';
import { cn } from 'cn';
import { CircleCheck, Link2, MapPin, Radar, ServerCog, ShieldAlert, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { BlastRadiusPanel } from '@/components/blast-radius';
import { RiskBars } from '@/components/risk-bars';
import type { ActionItem, DependencyInfo, RiskComponents } from '@/lib/api-types';

// Step 5 of the storyboard: one service's impact analysis, built entirely
// from the stored investigation (deterministic match, score, and the
// agent's written analysis). Nothing on this card is invented for the demo.

export interface InvestigationDetail {
  investigation: {
    id: string;
    status: string;
    priority: 'P1' | 'P2' | 'P3' | 'informational' | null;
    risk_score: number | null;
    risk_components: RiskComponents | null;
    escalated: boolean;
    escalation_reason: string | null;
    output: string | null;
    context: {
      match: { landedOn: string; landedKind: 'service' | 'infrastructure'; hops: 0 | 1; dependency: DependencyInfo | null };
    } | null;
  };
  actions: ActionItem[];
  signal: { external_id: string; title: string; vendor_project: string | null; product: string | null; provenance: string } | null;
  service: { name: string; department: string; resident_impact: string; impact_unit: string | null } | null;
  other_affected_services: string[];
}

export interface TimelineEntry {
  time: string;
  label: string;
}

type Tab = 'overview' | 'evidence' | 'risk' | 'remediation' | 'timeline';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'risk', label: 'Risk analysis' },
  { id: 'remediation', label: 'Remediation' },
  { id: 'timeline', label: 'Timeline' },
];

const humanize = (slug: string) =>
  slug
    .split('-')
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');

function levelFor(score: number) {
  if (score >= 80) return { label: 'High', tone: 'bg-status-critical/15 text-status-critical ring-status-critical/40' };
  if (score >= 60) return { label: 'Elevated', tone: 'bg-status-at-risk/15 text-status-at-risk ring-status-at-risk/40' };
  return { label: 'Moderate', tone: 'bg-muted text-foreground ring-foreground/15' };
}

export function ImpactCard({ detail, timeline }: { detail: InvestigationDetail; timeline: TimelineEntry[] }) {
  const [tab, setTab] = useState<Tab>('overview');
  const { investigation: inv, signal, service, actions, other_affected_services } = detail;
  const match = inv.context?.match;
  const score = inv.risk_score ?? 0;
  const level = levelFor(score);
  const narrative = (inv.output ?? '').split(/\n\n---\n\n/)[0].replace(/✅\s*\*\*Investigation complete\*\*/g, '').trim();

  const findings = [
    signal && {
      icon: ShieldAlert,
      text: `${signal.external_id} is in the CISA KEV catalog: actively exploited`,
    },
    signal && match && {
      icon: ServerCog,
      text: `Affected technology: ${signal.vendor_project} ${signal.product} on ${humanize(match.landedOn)}`,
    },
    match?.dependency && {
      icon: Link2,
      text: `${match.hops === 1 ? 'One hop' : 'Directly'} to ${service?.name ?? 'the service'} over a ${match.dependency.criticality} dependency`,
    },
    inv.risk_components && {
      icon: Radar,
      text: `Exploitation likelier than ${(inv.risk_components.epssPercentile * 100).toFixed(2)}% of published CVEs`,
    },
    other_affected_services.length > 0 && {
      icon: MapPin,
      text: `${other_affected_services.length} other city services share this infrastructure`,
    },
  ].filter(Boolean) as Array<{ icon: typeof ShieldAlert; text: string }>;

  return (
    <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-start gap-3 p-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-status-critical text-white">
          <MapPin className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold leading-tight">{service?.name}</p>
          <p className="text-sm text-muted-foreground">
            {signal?.external_id}, exposure through {match ? humanize(match.landedOn).toLowerCase() : 'shared infrastructure'}
          </p>
        </div>
        <Badge variant="destructive" className="h-7 px-3 text-sm">
          {inv.priority === 'P1' ? 'Critical' : 'At risk'}
        </Badge>
      </div>

      <div role="tablist" aria-label="Impact analysis views" className="flex gap-1 overflow-x-auto px-5">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'shrink-0 rounded-t-lg px-3.5 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              tab === t.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div key={tab} className="animate-in bg-muted/40 p-4 fade-in-0 duration-300 sm:p-5">
        {tab === 'overview' && (
          <div className="grid gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <div>
                <p className="text-sm text-muted-foreground">Risk score</p>
                <p className="tabular-nums">
                  <span className="text-4xl font-extrabold text-status-critical">{score}</span>
                  <span className="text-muted-foreground"> / 100</span>
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-status-critical transition-[width] duration-1000 ease-out" style={{ width: `${score}%` }} />
                </div>
              </div>
              <div className="flex flex-wrap gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Risk level</p>
                  <span className={cn('mt-1 inline-block rounded-md px-2.5 py-1 text-sm font-semibold ring-1', level.tone)}>{level.label}</span>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Priority</p>
                  <span className="mt-1 inline-block rounded-md bg-status-critical/15 px-2.5 py-1 text-sm font-semibold text-status-critical ring-1 ring-status-critical/40">
                    {inv.priority}
                  </span>
                </div>
              </div>
              {inv.escalated && inv.escalation_reason && (
                <p className="text-sm text-pretty text-status-critical">{inv.escalation_reason}</p>
              )}
            </div>
            <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <p className="font-semibold">Key findings</p>
              <ul className="mt-3 space-y-3">
                {findings.map((f) => (
                  <li key={f.text} className="flex gap-3 text-sm">
                    <f.icon className="mt-0.5 h-4 w-4 shrink-0 text-status-critical" aria-hidden />
                    <span className="text-pretty">{f.text}</span>
                  </li>
                ))}
              </ul>
            </div>
            {service && (
              <div className="flex gap-3 rounded-xl bg-status-critical/10 p-4 ring-1 ring-status-critical/30 md:col-span-2">
                <Users className="mt-0.5 h-5 w-5 shrink-0 text-status-critical" aria-hidden />
                <div>
                  <p className="font-semibold">Resident impact</p>
                  <p className="mt-0.5 text-sm text-pretty">{service.resident_impact}</p>
                  {service.impact_unit && <p className="mt-1 text-xs text-muted-foreground">Measured in {service.impact_unit}</p>}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'evidence' && (
          <div className="space-y-4">
            {match && service && (
              <BlastRadiusPanel
                landedOn={match.landedOn}
                landedKind={match.landedKind}
                serviceName={service.name}
                hops={match.hops}
                dependency={match.dependency}
                otherAffectedServices={other_affected_services}
              />
            )}
            {narrative && (
              <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
                <p className="font-semibold">The agent&apos;s analysis</p>
                <div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-pretty text-muted-foreground">
                  {narrative}
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              The exposure match is deterministic and auditable. The written analysis is generated by an AI agent from that
              match. Detroit&apos;s technology inventory in this demo is simulated.
            </p>
          </div>
        )}

        {tab === 'risk' && inv.risk_components && (
          <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <RiskBars components={inv.risk_components} score={score} />
          </div>
        )}

        {tab === 'remediation' && (
          <ol className="space-y-2">
            {actions.map((a) => (
              <li key={a.rank} className="flex items-center gap-3 rounded-lg bg-card px-4 py-3 text-sm ring-1 ring-foreground/10">
                <span className="w-5 font-bold tabular-nums text-muted-foreground">{a.rank}</span>
                <span className="min-w-0 flex-1 font-medium">{a.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{a.sla}</span>
              </li>
            ))}
          </ol>
        )}

        {tab === 'timeline' && (
          <ol className="relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-[9px] before:w-px before:bg-border">
            {timeline.map((t, i) => (
              <li key={i} className="relative flex items-center gap-3 text-sm">
                <CircleCheck className="relative z-10 h-5 w-5 shrink-0 rounded-full bg-muted text-status-ok" aria-hidden />
                <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{t.time}</span>
                <span>{t.label}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

const SLA_TONE = (sla: string) =>
  /now/i.test(sla) ? 'text-status-critical' : /hour/i.test(sla) ? 'text-status-at-risk' : 'text-muted-foreground';

// Step 6 of the storyboard: the agent's ranked action plan, the incident
// ticket, and the CISO alert.
export function ActionPlanCard({
  detail,
  alertState,
  alertReason,
  onSendAlert,
}: {
  detail: InvestigationDetail;
  alertState: 'idle' | 'sending' | 'sent' | 'not-sent';
  alertReason?: string;
  onSendAlert: () => void;
}) {
  const { investigation: inv, actions } = detail;
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
        <div className="flex items-center justify-between gap-3 px-5 pt-5">
          <p className="text-lg font-bold">Recommended actions</p>
          {inv.priority && (
            <Badge variant="destructive" className="h-7 px-3 text-sm">
              Priority: {inv.priority}
            </Badge>
          )}
        </div>
        <ol className="relative mx-5 mt-4 space-y-4 before:absolute before:top-3 before:bottom-3 before:left-[13px] before:w-px before:bg-border">
          {actions.map((a) => (
            <li key={a.rank} className="relative flex gap-4">
              <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-status-critical/15 text-sm font-bold text-status-critical ring-4 ring-card">
                {a.rank}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-semibold">{a.title}</p>
                  <span className={cn('shrink-0 text-sm font-semibold', SLA_TONE(a.sla))}>{a.sla}</span>
                </div>
                <p className="mt-0.5 text-sm text-pretty text-muted-foreground">
                  {a.detail} <span className="text-xs">Owner: {a.owner}</span>
                </p>
              </div>
            </li>
          ))}
        </ol>
        <div className="p-5">
          <a
            href={`/api/investigations/${inv.id}/ticket`}
            target="_blank"
            rel="noreferrer"
            className="flex h-12 w-full items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/85"
          >
            Create incident ticket
          </a>
        </div>
      </div>

      <div
        className={cn(
          'flex flex-wrap items-center gap-4 rounded-2xl p-5 ring-1 transition-colors duration-500',
          alertState === 'sent' ? 'bg-status-ok/10 ring-status-ok/40' : 'bg-card ring-foreground/10'
        )}
      >
        <span
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
            alertState === 'sent' ? 'bg-status-ok text-background' : 'bg-muted text-muted-foreground'
          )}
        >
          <CircleCheck className="h-6 w-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn('text-lg font-bold', alertState === 'sent' && 'text-status-ok')}>
            {alertState === 'sent' ? 'CISO alert delivered' : 'CISO alert ready'}
          </p>
          <p className="text-sm text-pretty text-muted-foreground">
            {alertState === 'sent'
              ? 'A detailed alert with evidence, impact analysis, and recommended actions was posted to the CISO channel in Slack.'
              : alertState === 'not-sent'
                ? alertReason
                : 'A detailed alert with evidence, impact analysis, and recommended actions is ready for the City of Detroit CISO.'}
          </p>
        </div>
        {alertState !== 'sent' && (
          <button
            onClick={onSendAlert}
            disabled={alertState === 'sending'}
            className="h-10 shrink-0 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-60"
          >
            {alertState === 'sending' ? 'Sending' : 'Send to Slack'}
          </button>
        )}
      </div>
    </div>
  );
}
