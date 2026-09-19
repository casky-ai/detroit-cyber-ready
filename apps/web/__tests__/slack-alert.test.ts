import { describe, it, expect } from 'vitest';
import { buildSlackAlert, orderByRisk, type SlackAlertInput, type SlackAlertInvestigation } from '../lib/slack-alert';

const DEP = {
  infrastructure: 'remote-access',
  kind: 'reachable-via' as const,
  criticality: 'hard' as const,
  rationale: 'Dispatch reaches its systems through the remote access tier.',
};

function inv(
  id: string,
  slug: string,
  name: string,
  criticality: string,
  score: number,
  actions: SlackAlertInvestigation['actions'],
  escalated = false
): SlackAlertInvestigation {
  return {
    investigation: {
      id,
      status: 'completed',
      priority: 'P1',
      risk_score: score,
      risk_components: { kevActive: 1, epssPercentile: 0.99983, criticalityWeight: 1, reachConfidence: 0.68 },
      escalated,
      escalation_reason: escalated ? 'Life-safety service reachable over a hard dependency.' : null,
      output: 'narrative',
      context: {
        match: {
          signal: {} as never,
          serviceSlug: slug,
          landedOn: 'remote-access',
          landedKind: 'infrastructure',
          matchBasis: 'vendor+product',
          matchedOn: {},
          hops: 1,
          dependency: DEP,
          confidence: 0.68,
        },
      },
      created_at: '2026-09-19T03:27:00.000Z',
      started_at: '2026-09-19T03:27:02.000Z',
      ended_at: '2026-09-19T03:27:14.000Z',
    },
    service: {
      slug,
      name,
      department: 'Detroit Public Safety / ITS',
      criticality,
      resident_impact: 'Potential disruption to emergency call handling, dispatch, and response times.',
      impact_unit: 'dispatch delay and response time',
    },
    actions,
  };
}

const PLAN_911 = [
  { rank: 1, title: 'Validate Ivanti exposure on remote access', detail: 'Confirm version.', sla: 'Now', owner: 'IT Security' },
  { rank: 2, title: 'Isolate remote access from dispatch', detail: 'Restrict access.', sla: 'Now', owner: 'Network Operations' },
  { rank: 3, title: 'Patch Ivanti Connect Secure', detail: 'Apply vendor patch.', sla: '< 1 hour', owner: 'Vendor Management' },
  { rank: 4, title: 'Monitor for unauthorized access', detail: 'Enable logging.', sla: 'Ongoing', owner: 'SOC' },
];

const INPUT: SlackAlertInput = {
  baseUrl: 'https://dcr.example',
  sentAt: new Date('2026-09-19T03:29:00.000Z'),
  signal: {
    external_id: 'CVE-2023-46805',
    source: 'cisa-kev',
    provenance: 'live',
    title: 'Ivanti Connect Secure and Policy Secure Authentication Bypass Vulnerability',
    vendor_project: 'Ivanti',
    product: 'Connect Secure',
    published_at: '2024-01-10T00:00:00.000Z',
    raw: { knownRansomwareCampaignUse: 'Known' },
  },
  investigations: [
    inv('pol', 'police', 'Police', 'critical', 95, [{ rank: 1, title: 'Validate police VPN', detail: 'x', sla: 'Now', owner: 'IT' }]),
    inv('911', '911-emergency-communications', '911 Emergency Communications', 'life-safety', 95, PLAN_911, true),
    inv('crt', 'courts', 'Courts', 'high', 87, []),
  ],
};

const alert = buildSlackAlert(INPUT);
const allText = JSON.stringify(alert);

describe('Slack CISO alert', () => {
  it('leads with the service at risk and its priority, not the CVE number', () => {
    const header = alert.blocks[0] as { text: { text: string } };
    expect(header.text.text).toContain('P1: 911 Emergency Communications exposed');
  });

  it('breaks a risk tie in favour of the life-safety service', () => {
    expect(orderByRisk(INPUT.investigations)[0].service.slug).toBe('911-emergency-communications');
  });

  it('says what to do right now in the first lines', () => {
    const bottomLine = (alert.blocks[1] as { text: { text: string } }).text.text;
    expect(bottomLine).toContain('Act now');
    expect(bottomLine).toContain('Validate Ivanti exposure on remote access');
    expect(bottomLine).toContain('Isolate remote access from dispatch');
    expect(alert.text).toContain('Now: Validate Ivanti exposure');
  });

  it('carries the complete action plan with deadline and owner for every step', () => {
    for (const a of PLAN_911) {
      expect(allText).toContain(a.title);
      expect(allText).toContain(a.owner);
    }
    expect(allText).toContain('`< 1 hour`');
  });

  it('includes the exposure path, findings, and resident impact', () => {
    expect(allText).toContain('Remote Access → 911 Emergency Communications');
    expect(allText).toContain('Key findings');
    expect(allText).toContain('Known ransomware use');
    expect(allText).toContain('99.98%');
    expect(allText).toContain('Potential disruption to emergency call handling');
  });

  it('lists the other affected services once, without repeating the shared plan', () => {
    expect(allText).toContain('*Police*: P1, risk 95, hard dependency');
    expect(allText).toContain('*Courts*: P1, risk 87, hard dependency');
    expect(allText).toContain('The Remote Access actions above cover these services too.');
    expect(allText).not.toContain('Validate police VPN');
  });

  it('labels the timeline by what happened, never "Step N"', () => {
    expect(allText).not.toMatch(/Step \d/);
    expect(allText).toContain('investigations opened');
    expect(allText).toContain('All 3 investigations complete');
    expect(allText).toContain('CISO alert sent');
  });

  it('links to the investigation and ticket with absolute URLs', () => {
    expect(allText).toContain('https://dcr.example/investigations/911');
    expect(allText).toContain('https://dcr.example/api/investigations/911/ticket');
  });

  it('states what is live and what is simulated', () => {
    expect(allText).toContain('inventory is simulated');
  });

  it('stays inside Slack block limits', () => {
    expect(alert.blocks.length).toBeLessThanOrEqual(50);
    for (const b of alert.blocks as Array<{ text?: { text: string } }>) {
      if (b.text) expect(b.text.text.length).toBeLessThanOrEqual(3000);
    }
  });

  it('uses no em dashes', () => {
    expect(allText).not.toContain('—');
  });
});
