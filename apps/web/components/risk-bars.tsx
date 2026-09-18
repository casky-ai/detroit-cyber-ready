// Four bars, one per scoring component, so the number is auditable rather
// than trusted. Matches computeRiskScore's exact formula weights — if that
// formula ever changes, these labels must change with it.

import { Progress } from '@/components/ui/progress';
import type { RiskComponents } from '@/lib/api-types';

interface RiskBarsProps {
  components: RiskComponents;
  score: number;
}

const ROWS: Array<{ key: keyof RiskComponents; label: string; weight: number; max: number }> = [
  { key: 'kevActive', label: 'Actively exploited (CISA KEV)', weight: 40, max: 1 },
  { key: 'epssPercentile', label: 'Exploitation probability (EPSS)', weight: 25, max: 1 },
  { key: 'criticalityWeight', label: 'Service criticality', weight: 20, max: 1 },
  { key: 'reachConfidence', label: 'Reach confidence', weight: 15, max: 1 },
];

export function RiskBars({ components, score }: RiskBarsProps) {
  return (
    <div className="space-y-3">
      {ROWS.map(({ key, label, weight, max }) => {
        const raw = components[key] ?? 0;
        const contribution = weight * (raw / max);
        return (
          <div key={key}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{label}</span>
              <span className="tabular-nums text-muted-foreground">
                {(raw * 100).toFixed(0)}% · +{contribution.toFixed(1)}
              </span>
            </div>
            <Progress value={(raw / max) * 100} className="h-1.5" />
          </div>
        );
      })}
      <div className="flex items-center justify-between pt-1 text-sm font-medium">
        <span>Total risk score</span>
        <span className="tabular-nums">{score}/100</span>
      </div>
    </div>
  );
}
