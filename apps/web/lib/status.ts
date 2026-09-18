// Maps a service's latest investigation to the four-state status
// vocabulary the whole UI is built on. Pure function, deliberately: the
// readiness board and any other view that needs "is this service OK" must
// go through this, never hardcode a color decision inline.

export type ServiceStatus = 'ok' | 'at-risk' | 'critical';

export interface LatestInvestigationSummary {
  status: string;
  priority: 'P1' | 'P2' | 'P3' | 'informational' | null;
}

export function computeServiceStatus(latest: LatestInvestigationSummary | null): ServiceStatus {
  if (!latest) return 'ok';
  if (latest.status !== 'completed' && latest.status !== 'failed') return 'at-risk'; // in progress
  if (latest.priority === 'P1') return 'critical';
  if (latest.priority === 'P2' || latest.priority === 'P3') return 'at-risk';
  return 'ok';
}

export const STATUS_LABEL: Record<ServiceStatus, string> = {
  ok: 'Operational',
  'at-risk': 'At Risk',
  critical: 'Critical',
};
