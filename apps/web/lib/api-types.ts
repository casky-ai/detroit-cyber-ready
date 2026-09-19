// Shared shapes for the client components that call this app's own API
// routes. Deliberately loose (not re-deriving full DB row types) — these
// are exactly the fields the UI reads.

export interface ServiceSummary {
  slug: string;
  name: string;
  department: string;
  address: string;
  criticality: 'life-safety' | 'critical' | 'high' | 'moderate' | 'low';
  resident_impact: string;
  impact_unit: string | null;
  externally_exposed: boolean;
  lat: number;
  lon: number;
  latest_investigation: {
    id: string;
    status: string;
    priority: 'P1' | 'P2' | 'P3' | 'informational' | null;
    risk_score: number | null;
    escalated: boolean;
    created_at: string;
  } | null;
}

export interface RiskComponents {
  kevActive: number;
  epssPercentile: number;
  criticalityWeight: number;
  reachConfidence: number;
}

export interface DependencyInfo {
  infrastructure: string;
  kind: string;
  criticality: 'hard' | 'soft';
  rationale: string;
}

export interface InjectResponse {
  investigation_id: string;
  signal_id: string;
  landed_on: string;
  landed_kind: 'service' | 'infrastructure';
  hops: 0 | 1;
  dependency: DependencyInfo | null;
  risk: {
    score: number;
    components: RiskComponents;
    priority: 'P1' | 'P2' | 'P3' | 'informational';
    escalated: boolean;
    escalationReason: string | null;
  };
  other_affected_services: string[];
}

export interface StepEvent {
  step: string;
  label: string;
  detail?: Record<string, unknown>;
  at: string;
}

export interface ActionItem {
  rank: number;
  title: string;
  detail: string;
  sla: string;
  owner: string;
}
