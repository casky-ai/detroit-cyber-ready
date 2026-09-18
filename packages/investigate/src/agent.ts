// The investigation agent. Everything the deterministic layers already
// decided (does Detroit have this exposure, which service, how far away,
// how urgent) arrives here as structured input — this file's only job is to
// explain it in plain language and turn it into an ordered action plan.
//
// It never decides whether Detroit is exposed. packages/impact already did
// that. If every LLM call in this file failed right now, the investigation
// would still know the right answer — it would just have a plainer
// narrative and a generic action list instead of a tailored one. That
// degradation path is deliberate, not a bug: see runInvestigation's catch
// blocks.

import type { SignalMatch } from '@dcr/impact/exposure';
import type { CityService } from '@dcr/impact/data';
import type { RiskResult } from '@dcr/impact/scoring';
import { z } from 'zod';
import { MODEL_HAIKU, MODEL_SONNET, streamText, callStructured } from './llm';
import { keywordsFor, narrowSkills, type NarrowedSkill } from './skills';
import { COMPLETE_MARKER } from './constants';
import { fetchCaskyEnrichment, type CaskyEnrichment } from './casky';

export interface InvestigationInput {
  match: SignalMatch;
  service: CityService;
  risk: RiskResult;
}

export type InvestigationStepName =
  | 'context-assembled'
  | 'context-enriched'
  | 'technique-assessed'
  | 'skills-selected'
  | 'impact-correlated'
  | 'plan-generated';

export interface InvestigationStepEvent {
  step: InvestigationStepName;
  label: string;
  detail?: Record<string, unknown>;
  at: string;
}

export const ActionItemSchema = z.object({
  title: z.string().min(1).max(120),
  detail: z.string().min(1),
  sla: z.enum(['Now', '< 1 hour', '< 24 hours', 'Ongoing']),
  owner: z.string().min(1),
});
export type ActionItem = z.infer<typeof ActionItemSchema> & { rank: number };

const ActionPlanSchema = z.array(ActionItemSchema).min(1).max(6);

export interface InvestigationResult {
  /** Full narrative text, ending with COMPLETE_MARKER. Never partial-and-silent. */
  narrative: string;
  actions: ActionItem[];
  selectedSkills: NarrowedSkill[];
  caskyEnrichment: CaskyEnrichment;
  /** True if either LLM call had to fall back to the deterministic path. */
  degraded: boolean;
  gaps: string[];
}

export interface RunInvestigationOptions {
  onStep?: (event: InvestigationStepEvent) => void;
  onNarrativeChunk?: (chunk: string) => void;
}

function step(name: InvestigationStepName, label: string, detail?: Record<string, unknown>): InvestigationStepEvent {
  return { step: name, label, detail, at: new Date().toISOString() };
}

/** One deterministic sentence describing the exposure. No LLM, always available. */
function describeExposure(input: InvestigationInput): string {
  const { match, service, risk } = input;
  const vendor = match.signal.vendor_project ?? 'an unnamed vendor';
  const product = match.signal.product ?? 'an unnamed product';
  const kevPart =
    match.signal.kind === 'kev-addition'
      ? `${match.signal.external_id} was added to CISA's Known Exploited Vulnerabilities catalog`
      : `a new external signal was observed (${match.signal.title})`;

  const reachPart =
    match.hops === 0
      ? `directly affecting ${service.name}'s own technology`
      : `reaching ${service.name} through a ${match.dependency?.criticality} dependency on ${match.dependency?.infrastructure}`;

  return `${kevPart}, affecting ${vendor} ${product}, ${reachPart}. Priority ${risk.priority}, risk score ${risk.score}/100.`;
}

const NARRATIVE_SYSTEM_PROMPT = `You narrate cybersecurity exposure investigations for Detroit Cyber Ready, a municipal security monitoring tool used by a city CISO and non-technical city officials.

Rules, all mandatory:
- Never state or imply the city is currently being attacked or has been breached. This is an external signal that may indicate exposure, not confirmed compromise. Use phrasing like "new external threat signal," "potential exposure," "requires investigation."
- Be concrete: name the vendor and product, the affected city service, and the dependency path if the exposure reaches the service indirectly.
- Write two to four short paragraphs of plain prose. No bullet points, no markdown headers — a separate action plan covers next steps.
- Ground every claim in the structured input you are given. If a data point (EPSS, CVSS) is missing, say it could not be scored on that dimension rather than inventing a number.
- Close by naming the resident impact in the terms given, e.g. "dispatch delay and response time" for a life-safety service.`;

const ACTION_PLAN_SYSTEM_PROMPT = `You produce a prioritized incident response action plan for a municipal security team.

Output ONLY a JSON array, nothing else — no markdown fences, no commentary. Between 3 and 5 objects, each with exactly these keys:
- "title": string, at most 80 characters
- "detail": string, one concrete sentence
- "sla": one of "Now", "< 1 hour", "< 24 hours", "Ongoing"
- "owner": a role, e.g. "IT Security", "Network Operations", "Vendor Management"

Order by urgency, most urgent first. Ground every action in the specific vendor, product, service, and dependency named in the input. The first action is always about validating the exposure is real before remediating it.`;

function buildUserContext(
  input: InvestigationInput,
  selectedSkills: NarrowedSkill[],
  caskyEnrichment: CaskyEnrichment
): string {
  const { match, service, risk } = input;
  return JSON.stringify(
    {
      signal: {
        source: match.signal.source,
        external_id: match.signal.external_id,
        kind: match.signal.kind,
        title: match.signal.title,
        vendor: match.signal.vendor_project,
        product: match.signal.product,
        cvss_score: match.signal.cvss_score,
      },
      match: {
        landed_on: match.landedOn,
        landed_kind: match.landedKind,
        hops: match.hops,
        dependency: match.dependency,
        match_basis: match.matchBasis,
      },
      service: {
        name: service.name,
        department: service.department,
        criticality: service.criticality,
        resident_impact: service.resident_impact,
        impact_unit: service.impact_unit,
      },
      risk: {
        score: risk.score,
        priority: risk.priority,
        escalated: risk.escalated,
        escalation_reason: risk.escalationReason,
        components: risk.components,
      },
      candidate_response_skills: selectedSkills.map((s) => s.name),
      // Only included when Casky's platform genuinely has something to
      // say about this CVE — an empty/unavailable lookup contributes
      // nothing here rather than an empty placeholder the model might
      // otherwise try to comment on.
      casky_platform_context: caskyEnrichment.spotlight
        ? {
            existing_analysis: caskyEnrichment.spotlight.ai_analysis,
            known_technique_ids: caskyEnrichment.spotlight.technique_ids,
          }
        : null,
      matching_playbooks: caskyEnrichment.playbooks.map((p) => p.name),
    },
    null,
    2
  );
}

const NARRATIVE_TIMEOUT_MS = 45_000;
const ACTION_PLAN_TIMEOUT_MS = 20_000;

function fallbackActions(input: InvestigationInput): ActionItem[] {
  const { match, service } = input;
  const infra = match.dependency?.infrastructure ?? match.landedOn;
  return [
    { rank: 1, title: 'Validate exposure', detail: `Confirm the affected ${infra} asset is in use and reachable as described.`, sla: 'Now', owner: 'IT Security' },
    { rank: 2, title: 'Isolate or mitigate', detail: `Restrict or disable external access to ${infra} if the exposure is confirmed.`, sla: '< 1 hour', owner: 'Network Operations' },
    { rank: 3, title: 'Apply patch or configuration change', detail: `Apply the vendor-recommended fix for ${match.signal.product ?? 'the affected product'}.`, sla: '< 24 hours', owner: 'IT Security' },
    { rank: 4, title: 'Monitor for indicators', detail: `Watch logs and traffic for signs of exploitation affecting ${service.name}.`, sla: 'Ongoing', owner: 'Security Operations' },
    { rank: 5, title: 'Coordinate with stakeholders', detail: `Notify ${service.department} leadership of the potential exposure.`, sla: 'Now', owner: 'CISO Office' },
  ];
}

export async function runInvestigation(
  input: InvestigationInput,
  options: RunInvestigationOptions = {}
): Promise<InvestigationResult> {
  const gaps: string[] = [];
  let degraded = false;

  options.onStep?.(
    step('context-assembled', 'Context assembled', {
      service: input.service.slug,
      landedOn: input.match.landedOn,
    })
  );

  const caskyEnrichment = await fetchCaskyEnrichment(input.match.signal.external_id);
  gaps.push(...caskyEnrichment.gaps);
  options.onStep?.(
    step(
      'context-enriched',
      caskyEnrichment.spotlight
        ? 'Found existing Casky analysis for this CVE'
        : 'No existing Casky analysis available for this CVE',
      { hasSpotlight: Boolean(caskyEnrichment.spotlight), playbookCount: caskyEnrichment.playbooks.length }
    )
  );

  options.onStep?.(step('technique-assessed', describeExposure(input)));

  const keywords = keywordsFor(
    input.match.landedOn,
    input.match.signal.vendor_project ?? '',
    input.match.signal.product ?? ''
  );
  const selectedSkills = await narrowSkills(keywords);
  if (selectedSkills.length === 0) {
    gaps.push('No matching response skills found in the corpus for this exposure type.');
  }
  options.onStep?.(
    step(
      'skills-selected',
      selectedSkills.length > 0
        ? `Selected ${selectedSkills.length} response skill${selectedSkills.length === 1 ? '' : 's'}`
        : 'No matching response skills found',
      { skills: selectedSkills.map((s) => s.name) }
    )
  );

  options.onStep?.(
    step('impact-correlated', `${input.service.name}: priority ${input.risk.priority}, risk ${input.risk.score}/100`, {
      priority: input.risk.priority,
      score: input.risk.score,
      hops: input.match.hops,
    })
  );

  const userContext = buildUserContext(input, selectedSkills, caskyEnrichment);

  let narrativeBody: string;
  try {
    const result = await streamText({
      model: MODEL_SONNET,
      system: NARRATIVE_SYSTEM_PROMPT,
      user: userContext,
      maxTokens: 600,
      timeoutMs: NARRATIVE_TIMEOUT_MS,
      onChunk: options.onNarrativeChunk,
    });
    if (!result.text.trim()) {
      throw new Error('empty narrative');
    }
    narrativeBody = result.text;
    if (result.timedOut) {
      gaps.push('Narrative generation timed out; showing partial output.');
      degraded = true;
    }
  } catch (err) {
    degraded = true;
    gaps.push(`Narrative generation unavailable (${err instanceof Error ? err.message : 'unknown error'}); showing a structured summary instead.`);
    narrativeBody = describeExposure(input);
    options.onNarrativeChunk?.(narrativeBody);
  }

  let actions: ActionItem[];
  try {
    const parsed = await callStructured(
      {
        model: MODEL_HAIKU,
        system: ACTION_PLAN_SYSTEM_PROMPT,
        user: userContext,
        maxTokens: 800,
        timeoutMs: ACTION_PLAN_TIMEOUT_MS,
      },
      (value): value is z.infer<typeof ActionPlanSchema> => ActionPlanSchema.safeParse(value).success
    );
    actions = parsed.map((a, i) => ({ ...a, rank: i + 1 }));
  } catch (err) {
    degraded = true;
    gaps.push(`Action plan generation unavailable (${err instanceof Error ? err.message : 'unknown error'}); using the standard response checklist instead.`);
    actions = fallbackActions(input);
  }

  options.onStep?.(step('plan-generated', `${actions.length} actions generated`));

  const narrative = `${narrativeBody}\n\n---\n\n${COMPLETE_MARKER}\n`;

  return { narrative, actions, selectedSkills, caskyEnrichment, degraded, gaps };
}
