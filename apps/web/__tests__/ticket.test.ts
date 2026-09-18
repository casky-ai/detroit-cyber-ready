import { describe, it, expect } from 'vitest';
import { buildIncidentTicketMarkdown, type TicketInput } from '../lib/ticket';
import { COMPLETE_MARKER } from '../lib/constants';

const BASE_INPUT: TicketInput = {
  investigation: {
    id: 'inv-1',
    status: 'completed',
    priority: 'P1',
    risk_score: 91,
    risk_components: { kevActive: 1, epssPercentile: 0.85, criticalityWeight: 1.0, reachConfidence: 0.68 },
    escalated: true,
    escalation_reason: 'Life-safety service reachable over a hard dependency from actively exploited shared infrastructure.',
    output: `This is the narrative.\n\n---\n\n${COMPLETE_MARKER}\n`,
    context: {
      match: {
        signal: {} as never,
        serviceSlug: '911-emergency-communications',
        landedOn: 'remote-access',
        landedKind: 'infrastructure',
        matchBasis: 'vendor+product',
        matchedOn: {},
        hops: 1,
        dependency: {
          infrastructure: 'remote-access',
          kind: 'reachable-via',
          criticality: 'hard',
          rationale: 'Dispatch reaches its systems through the remote access tier.',
        },
        confidence: 0.68,
      },
    },
    created_at: '2026-09-18T12:00:00.000Z',
    ended_at: '2026-09-18T12:01:00.000Z',
  },
  signal: {
    external_id: 'CVE-2023-46805',
    source: 'cisa-kev',
    provenance: 'live',
    title: 'Ivanti Connect Secure and Policy Secure Authentication Bypass Vulnerability',
    vendor_project: 'Ivanti',
    product: 'Connect Secure',
    published_at: '2024-01-10T00:00:00.000Z',
  },
  service: {
    slug: '911-emergency-communications',
    name: '911 Emergency Communications',
    department: 'Detroit Public Safety / ITS',
    criticality: 'life-safety',
    resident_impact: 'Potential disruption to emergency call handling, dispatch, and response times.',
    impact_unit: 'dispatch delay and response time',
  },
  actions: [
    { rank: 1, title: 'Validate exposure', detail: 'Confirm the asset is reachable.', sla: 'Now', owner: 'IT Security' },
    { rank: 2, title: 'Isolate or mitigate', detail: 'Restrict external access.', sla: '< 1 hour', owner: 'Network Operations' },
  ],
};

describe('buildIncidentTicketMarkdown', () => {
  it('strips the completion marker from the visible narrative', () => {
    const md = buildIncidentTicketMarkdown(BASE_INPUT);
    expect(md).not.toContain(COMPLETE_MARKER);
    expect(md).toContain('This is the narrative.');
  });

  it('includes the dependency chain in plain language', () => {
    const md = buildIncidentTicketMarkdown(BASE_INPUT);
    expect(md).toMatch(/hard.*dependency.*remote-access/i);
  });

  it('includes the resident impact and its unit', () => {
    const md = buildIncidentTicketMarkdown(BASE_INPUT);
    expect(md).toContain('Potential disruption to emergency call handling');
    expect(md).toContain('dispatch delay and response time');
  });

  it('includes the escalation reason only when escalated', () => {
    const md = buildIncidentTicketMarkdown(BASE_INPUT);
    expect(md).toContain('Escalation');
    expect(md).toContain('Life-safety service reachable');

    const notEscalated = buildIncidentTicketMarkdown({
      ...BASE_INPUT,
      investigation: { ...BASE_INPUT.investigation, escalated: false, escalation_reason: null },
    });
    expect(notEscalated).not.toContain('## Escalation');
  });

  it('lists actions in rank order with SLA and owner', () => {
    const md = buildIncidentTicketMarkdown(BASE_INPUT);
    expect(md).toMatch(/1\. \*\*Validate exposure\*\* \(Now, IT Security\)/);
    expect(md).toMatch(/2\. \*\*Isolate or mitigate\*\* \(< 1 hour, Network Operations\)/);
  });

  it('discloses provenance honestly for a live signal', () => {
    const md = buildIncidentTicketMarkdown(BASE_INPUT);
    expect(md).toContain('Live threat intelligence.');
  });

  it('discloses provenance honestly for a synthetic signal', () => {
    const md = buildIncidentTicketMarkdown({
      ...BASE_INPUT,
      signal: { ...BASE_INPUT.signal, provenance: 'synthetic' },
    });
    expect(md).toContain('Simulated for demonstration purposes.');
  });

  it('handles a still-running investigation without a narrative gracefully', () => {
    const md = buildIncidentTicketMarkdown({
      ...BASE_INPUT,
      investigation: { ...BASE_INPUT.investigation, output: null },
    });
    expect(md).toContain('still in progress');
  });

  it('is deterministic: same input, same output', () => {
    expect(buildIncidentTicketMarkdown(BASE_INPUT)).toBe(buildIncidentTicketMarkdown(BASE_INPUT));
  });
});
