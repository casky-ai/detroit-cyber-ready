// Builds the Slack alert a CISO receives when a signal reaches city
// services. A pure function over stored investigation records (no request
// body content), so what lands in Slack is exactly what the database says,
// and the same records always produce the same message.
//
// Ordered by what the reader does with it: what is at risk and how badly,
// what to do right now, the full plan with owners and deadlines, the
// evidence behind it, then the other services and the timeline.

import type { TicketAction, TicketInvestigation, TicketService, TicketSignal } from './ticket';

export interface SlackAlertInvestigation {
  investigation: TicketInvestigation & { started_at: string | null };
  service: TicketService;
  actions: TicketAction[];
}

export interface SlackAlertInput {
  baseUrl: string;
  signal: TicketSignal & { raw?: Record<string, unknown> | null };
  investigations: SlackAlertInvestigation[];
  sentAt: Date;
}

// Slack rejects section text over 3000 characters and messages over 50
// blocks; stay well inside both.
const SECTION_LIMIT = 2900;
const DETAIL_LIMIT = 240;

const CRITICALITY_RANK: Record<string, number> = { 'life-safety': 0, critical: 1, high: 2, moderate: 3, low: 4 };

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const humanize = (slug: string) =>
  slug
    .split('-')
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
const detroitTime = (iso: string | Date) =>
  new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'America/Detroit',
  });

function mrkdwn(text: string) {
  return { type: 'section', text: { type: 'mrkdwn', text: clip(text, SECTION_LIMIT) } };
}

/** Highest risk first; ties go to the more critical service (911 over Police). */
export function orderByRisk(list: SlackAlertInvestigation[]): SlackAlertInvestigation[] {
  return [...list].sort(
    (a, b) =>
      (b.investigation.risk_score ?? 0) - (a.investigation.risk_score ?? 0) ||
      (CRITICALITY_RANK[a.service.criticality] ?? 9) - (CRITICALITY_RANK[b.service.criticality] ?? 9)
  );
}

export function buildSlackAlert(input: SlackAlertInput) {
  const { signal, baseUrl } = input;
  const ordered = orderByRisk(input.investigations);
  const lead = ordered[0];
  const others = ordered.slice(1);
  const inv = lead.investigation;
  const match = inv.context?.match;
  const dep = match?.dependency ?? null;
  const infra = dep ? humanize(dep.infrastructure) : null;
  const product = [signal.vendor_project, signal.product].filter(Boolean).join(' ');
  const ransomware = signal.raw?.knownRansomwareCampaignUse === 'Known';
  const epss = inv.risk_components?.epssPercentile;
  const nowActions = lead.actions.filter((a) => /^now$/i.test(a.sla.trim()));

  // 1. Headline: the service and the priority, not the CVE number.
  const headline = `${inv.priority ?? 'Unscored'}: ${lead.service.name} exposed`;

  // 2. Bottom line, readable on a lock screen.
  const reach = infra
    ? `Detroit runs it on *${infra}*, which *${lead.service.name}*${others.length ? ` and ${others.length} other city service${others.length === 1 ? '' : 's'}` : ''} depend on.`
    : `It affects *${lead.service.name}* directly.`;
  const actNow = nowActions.length
    ? `\n*Act now:* ${nowActions.map((a) => a.title).join('; ')}.`
    : '';
  const bottomLine = `*${signal.external_id}* (${product || signal.title}) is being actively exploited. ${reach}${actNow}`;

  // 3. The facts a CISO checks before paging anyone.
  const fields = [
    `*Priority*\n${inv.priority ?? 'n/a'}${inv.escalated ? ', escalated (life-safety rule)' : ''}`,
    `*Risk score*\n${inv.risk_score ?? 'n/a'} / 100`,
    `*Exposure path*\n${infra ? `${infra} → ${lead.service.name}\n${dep!.criticality} dependency, ${match!.hops} hop` : 'Direct, own technology'}`,
    `*Signal*\nCISA KEV, actively exploited${ransomware ? '\nKnown ransomware use' : ''}`,
    `*Resident impact*\n${clip(lead.service.resident_impact.trim(), 300)}`,
    `*Owner department*\n${lead.service.department}`,
  ].map((text) => ({ type: 'mrkdwn', text }));

  // 4. The full plan for the highest-risk service.
  const plan = lead.actions
    .map((a) => `*${a.rank}. ${a.title}*  \`${a.sla}\`\n${clip(a.detail, DETAIL_LIMIT)}\n_Owner: ${a.owner}_`)
    .join('\n\n');

  // 5. Deterministic findings: every line is traceable to the match or score.
  const findings = [
    `${signal.external_id} is in the CISA Known Exploited Vulnerabilities catalog`,
    product && infra ? `Affected technology: ${product} on ${infra}` : null,
    dep ? `${lead.service.name} reaches it over a *${dep.criticality}* dependency: ${dep.rationale.trim()}` : null,
    typeof epss === 'number' ? `Exploitation likelier than ${(epss * 100).toFixed(2)}% of published CVEs (FIRST EPSS)` : null,
    inv.escalated && inv.escalation_reason ? `Escalated: ${inv.escalation_reason}` : null,
  ]
    .filter(Boolean)
    .map((f) => `• ${f}`)
    .join('\n');

  // 6. Everything else the signal reaches. They share the root cause, so
  // the plan above covers them; what differs is how each depends on it.
  const otherLines = others
    .map(({ investigation: o, service }) => {
      const d = o.context?.match?.dependency;
      return `• *${service.name}*: ${o.priority ?? 'n/a'}, risk ${o.risk_score ?? 'n/a'}${d ? `, ${d.criticality} dependency` : ''}`;
    })
    .join('\n');

  // 7. Timeline from stored timestamps, labelled by what happened.
  const opened = ordered.map((o) => o.investigation.created_at).sort()[0];
  const started = ordered
    .map((o) => o.investigation.started_at)
    .filter((t): t is string => !!t)
    .sort()[0];
  const ended = ordered.map((o) => o.investigation.ended_at).filter((t): t is string => !!t).sort();
  const timeline = [
    opened && [opened, `${signal.external_id} matched to Detroit's inventory; ${ordered.length} investigation${ordered.length === 1 ? '' : 's'} opened`],
    started && [started, `Casky agents began investigating in parallel`],
    inv.ended_at && [inv.ended_at, `${lead.service.name} assessed: ${inv.priority}, risk ${inv.risk_score}`],
    ended.length === ordered.length && [ended[ended.length - 1], `All ${ordered.length} investigations complete`],
    [input.sentAt.toISOString(), 'CISO alert sent'],
  ]
    .filter((t): t is [string, string] => Array.isArray(t))
    .map(([t, label]) => `\`${detroitTime(t)}\`  ${label}`)
    .join('\n');

  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: clip(`🚨 ${headline}`, 150), emoji: true } },
    mrkdwn(bottomLine),
    { type: 'section', fields },
    { type: 'divider' },
    mrkdwn(`*Action plan for ${lead.service.name}*\n\n${plan || '_No actions recorded yet._'}`),
    { type: 'divider' },
    mrkdwn(`*Key findings*\n${findings}`),
  ];
  if (others.length) {
    const cover = infra ? `\n_The ${infra} actions above cover these services too._` : '';
    blocks.push(mrkdwn(`*Also affected through ${infra ?? 'the same signal'}*\n${otherLines}${cover}`));
  }
  blocks.push(
    mrkdwn(`*Timeline* (Detroit time)\n${timeline}`),
    {
      type: 'actions',
      elements: [
        { type: 'button', style: 'danger', text: { type: 'plain_text', text: 'Open investigation' }, url: `${baseUrl}/investigations/${inv.id}` },
        { type: 'button', text: { type: 'plain_text', text: 'Incident ticket' }, url: `${baseUrl}/api/investigations/${inv.id}/ticket` },
        { type: 'button', text: { type: 'plain_text', text: 'City dashboard' }, url: baseUrl },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text:
            'Threat intelligence is live (CISA KEV, FIRST EPSS). Detroit\'s technology inventory is simulated for this demo. ' +
            'The exposure match is deterministic; the action plan was written by an AI agent from that match. Sent by Detroit Cyber Ready.',
        },
      ],
    }
  );

  return {
    // Notification preview text: service, priority, and the first thing to do.
    text: `${headline} via ${signal.external_id}.${nowActions[0] ? ` Now: ${nowActions[0].title}.` : ''}`,
    blocks,
  };
}
