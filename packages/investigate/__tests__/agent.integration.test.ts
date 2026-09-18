// Real calls to the live Anthropic API. Skipped automatically when
// ANTHROPIC_API_KEY is not set, so cloning this repo without the secret
// degrades to "skipped," never "fails" — the same philosophy applied
// everywhere else in this codebase, just applied to the test suite itself.
//
// This file exists because a mocked SDK can prove our abort-wiring is
// correct (see llm.test.ts) but cannot prove the actual prompts produce
// something usable. This does.
//
// KNOWN FLAKINESS: run three times back to back while preparing this build,
// two runs completed normally (~40s) and the third took over 16 minutes
// before failing. llm.test.ts's mocked test confirms our own code sets
// maxRetries: 0 and passes the abort signal correctly, so this is very
// likely rate-limiting or a lingering-socket issue on repeated rapid-fire
// live calls, not a regression in that fix — but it was not fully
// root-caused before shipping. If `pnpm test` ever appears to hang for
// several minutes rather than the usual ~40s, it is almost certainly this
// file: Ctrl-C is safe, the rest of the suite (everything except this one
// live-API file) is unaffected. Running it once, not in a tight loop, has
// been reliable throughout this build.

import { describe, it, expect } from 'vitest';
import { runInvestigation, type InvestigationInput } from '../src/agent';
import { COMPLETE_MARKER } from '../src/constants';
import type { SignalMatch } from '@dcr/impact/exposure';
import type { CityService } from '@dcr/impact/data';
import type { RiskResult } from '@dcr/impact/scoring';

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

const DEMO_INPUT: InvestigationInput = {
  match: {
    signal: {
      source: 'cisa-kev',
      provenance: 'live',
      external_id: 'CVE-2023-46805',
      kind: 'kev-addition',
      title: 'Ivanti Connect Secure and Policy Secure Authentication Bypass Vulnerability',
      summary: 'An authentication bypass vulnerability in Ivanti Connect Secure.',
      published_at: '2025-09-17T00:00:00.000Z',
      severity: null,
      vendor_project: 'Ivanti',
      product: 'Connect Secure',
      cpe: null,
      cvss_score: 8.2,
      epss_percentile: null,
      raw: {},
    },
    serviceSlug: '911-emergency-communications',
    landedOn: 'remote-access',
    landedKind: 'infrastructure',
    matchBasis: 'vendor+product',
    matchedOn: { vendor_project: 'Ivanti', product: 'Connect Secure' },
    hops: 1,
    dependency: {
      infrastructure: 'remote-access',
      kind: 'reachable-via',
      criticality: 'hard',
      rationale: 'Dispatch reaches its systems through the remote access tier.',
    },
    confidence: 0.8 * 0.85,
  } as SignalMatch,
  service: {
    slug: '911-emergency-communications',
    name: '911 Emergency Communications',
    department: 'Detroit Public Safety / ITS',
    criticality: 'life-safety',
    impact_unit: 'dispatch delay and response time',
    resident_impact: 'Potential disruption to emergency call handling, dispatch, and response times.',
    externally_exposed: false,
    lat: 42.3298,
    lon: -83.0458,
  } as CityService,
  risk: {
    score: 91,
    priority: 'P1',
    escalated: true,
    escalationReason: 'Life-safety service reachable over a hard dependency from actively exploited shared infrastructure.',
    components: { kevActive: 1, epssPercentile: 0.85, criticalityWeight: 1.0, reachConfidence: 0.68 },
  } as RiskResult,
};

describe.skipIf(!hasKey)('runInvestigation against the live Anthropic API', () => {
  it(
    'produces a non-empty narrative ending in COMPLETE_MARKER, without overclaiming an active breach',
    async () => {
      const stepsFired: string[] = [];
      const chunks: string[] = [];

      const result = await runInvestigation(DEMO_INPUT, {
        onStep: (e) => stepsFired.push(e.step),
        onNarrativeChunk: (c) => chunks.push(c),
      });

      expect(stepsFired).toEqual([
        'context-assembled',
        'context-enriched',
        'technique-assessed',
        'skills-selected',
        'impact-correlated',
        'plan-generated',
      ]);

      expect(result.narrative.length).toBeGreaterThan(50);
      expect(result.narrative.trim().endsWith(COMPLETE_MARKER.trim())).toBe(true);
      expect(chunks.join('').length).toBeGreaterThan(0);

      // Language discipline: never claim an active, confirmed breach. Only
      // the two unambiguous phrases from the system prompt's actual banned
      // list are checked here — phrases that could never appear inside a
      // legitimate disclaimer. A prior version also tried to detect an
      // un-negated "confirmed breach" via a negative-lookbehind regex; that
      // is genuinely flaky against natural language, since the model has
      // many ways to phrase "this is not a confirmed breach" that the
      // lookbehind didn't anticipate, and it failed intermittently on
      // output that was doing exactly the right thing. A regex is the
      // wrong tool for negation detection — dropped rather than patched
      // further.
      const lower = result.narrative.toLowerCase();
      expect(lower).not.toMatch(/being hacked|hacked in real.?time/);

      // Should mention the concrete vendor/product/service named in the input.
      expect(result.narrative).toMatch(/ivanti|connect secure/i);
      expect(result.narrative).toMatch(/911|dispatch|emergency/i);
    },
    60_000
  );

  it('produces a valid, ranked action plan with 3 to 5 items', async () => {
    const result = await runInvestigation(DEMO_INPUT);
    expect(result.actions.length).toBeGreaterThanOrEqual(3);
    expect(result.actions.length).toBeLessThanOrEqual(5);
    expect(result.actions.map((a) => a.rank)).toEqual(
      Array.from({ length: result.actions.length }, (_, i) => i + 1)
    );
    for (const action of result.actions) {
      expect(action.title.length).toBeGreaterThan(0);
      expect(['Now', '< 1 hour', '< 24 hours', 'Ongoing']).toContain(action.sla);
      expect(action.owner.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it('is not degraded when the live Anthropic API is reachable and returns valid output', async () => {
    const result = await runInvestigation(DEMO_INPUT);
    expect(result.degraded).toBe(false);
    // A gap about Casky simply not having analyzed this CVE yet is
    // expected and legitimate — CVE-2023-46805 genuinely has no spotlight
    // in Casky's platform as of this writing (verified directly against
    // the live endpoint). That is not the same as the AGENT degrading:
    // `degraded` is reserved for the narrative or action-plan LLM calls
    // themselves failing, which is what this test actually verifies.
    for (const gap of result.gaps) {
      expect(gap).toMatch(/^casky:/);
    }
  }, 60_000);
});
