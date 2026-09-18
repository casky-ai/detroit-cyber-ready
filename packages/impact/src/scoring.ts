// Risk scoring. Four explainable components, rendered as four bars in the
// UI so a human can audit the number rather than trust it.
//
// The life-safety escalation rule can only raise a priority, never lower
// one the formula already set higher. A scoring formula that could talk a
// CISO out of paging someone about dispatch is a formula that eventually
// will — so that decision is hardcoded, not learned.

import type { CityService } from './data';
import type { SignalMatch } from './exposure';

export interface RiskComponents {
  kevActive: number; // 0 or 1
  epssPercentile: number; // 0 to 1
  criticalityWeight: number; // per-tier weight
  reachConfidence: number; // stage 2 output, after hop decay
}

export type Priority = 'P1' | 'P2' | 'P3' | 'informational';

export interface RiskResult {
  score: number;
  components: RiskComponents;
  priority: Priority;
  escalated: boolean;
  escalationReason: string | null;
}

const CRITICALITY_WEIGHT: Record<CityService['criticality'], number> = {
  'life-safety': 1.0,
  critical: 0.8,
  high: 0.6,
  moderate: 0.4,
  low: 0.2,
};

const ESCALATION_REASON =
  'Life-safety service reachable over a hard dependency from actively exploited shared infrastructure.';

function priorityFromScore(score: number): Priority {
  if (score >= 80) return 'P1';
  if (score >= 60) return 'P2';
  if (score >= 40) return 'P3';
  return 'informational';
}

/**
 * A match's own dependency criticality when it came in at one hop; a direct
 * hit on the service's own technology (hops 0) is, by definition, at least
 * as serious as a hard dependency, so it counts as hard for escalation
 * purposes.
 */
function isHardPath(match: SignalMatch): boolean {
  if (match.hops === 0) return true;
  return match.dependency?.criticality === 'hard';
}

/**
 * @param epssPercentileOverride EPSS is queried per-CVE, separately from
 *   whichever signal triggered the match (a KEV addition carries no EPSS
 *   score of its own). Pass the looked-up EPSS percentile for the same
 *   CVE here; falls back to 0 if not supplied or not found.
 */
export function computeRiskScore(
  match: SignalMatch,
  service: CityService,
  epssPercentileOverride?: number | null
): RiskResult {
  const kevActive = match.signal.kind === 'kev-addition' ? 1 : 0;
  const epssPercentile = epssPercentileOverride ?? match.signal.epss_percentile ?? 0;
  const criticalityWeight = CRITICALITY_WEIGHT[service.criticality];
  const reachConfidence = match.confidence;

  const components: RiskComponents = { kevActive, epssPercentile, criticalityWeight, reachConfidence };

  const rawScore = 40 * kevActive + 25 * epssPercentile + 20 * criticalityWeight + 15 * reachConfidence;
  const score = Math.round(rawScore);

  let priority = priorityFromScore(score);
  let escalated = false;
  let escalationReason: string | null = null;

  if (service.criticality === 'life-safety' && kevActive === 1 && isHardPath(match)) {
    if (priority !== 'P1') {
      priority = 'P1';
    }
    escalated = true;
    escalationReason = ESCALATION_REASON;
  }

  return { score, components, priority, escalated, escalationReason };
}
