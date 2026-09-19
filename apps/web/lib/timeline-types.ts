// Shared shapes for the /demo timeline experience.

export interface DemoSignal {
  external_id: string;
  title: string;
  summary: string;
  source: string;
  vendor_project: string;
  product: string;
  cvss_score: number;
  epss_percentile: number;
  published_at: string;
}

export interface DemoInvestigationSeed {
  investigation_id: string;
  service_slug: string;
  service_name: string;
  landed_on: string;
  hops: 0 | 1;
  dependency: { infrastructure: string; kind: string; criticality: 'hard' | 'soft'; rationale: string } | null;
  risk: {
    score: number;
    priority: 'P1' | 'P2' | 'P3' | 'informational';
    escalated: boolean;
    escalationReason: string | null;
  };
}

export interface DemoStartResponse {
  signal_id: string;
  signal: DemoSignal;
  investigations: DemoInvestigationSeed[];
}

export interface TimelineEvent {
  time: string; // HH:MM:SS, real wall clock
  label: string;
  kind: 'system' | 'agent' | 'alert';
}

export type AgentPhase = 'queued' | 'running' | 'completed' | 'failed';

export interface AgentState {
  seed: DemoInvestigationSeed;
  phase: AgentPhase;
  steps: string[];
  narrative: string;
  actions: Array<{ rank: number; title: string; detail: string; sla: string; owner: string }>;
}
