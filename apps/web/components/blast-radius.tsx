// The demo's centerpiece: two boxes, one line. Never more. If this ever
// needs a third box, that is a sign the underlying model has drifted from
// the one-hop-only design in packages/impact/src/exposure.ts — the whole
// point is that this stays legible at a glance.

import { Badge } from '@/components/ui/badge';
import type { DependencyInfo } from '@/lib/api-types';

interface BlastRadiusPanelProps {
  landedOn: string;
  landedKind: 'service' | 'infrastructure';
  serviceName: string;
  hops: 0 | 1;
  dependency: DependencyInfo | null;
  otherAffectedServices: string[];
}

function humanizeSlug(slug: string): string {
  return slug
    .split('-')
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
}

export function BlastRadiusPanel({
  landedOn,
  landedKind,
  serviceName,
  hops,
  dependency,
  otherAffectedServices,
}: BlastRadiusPanelProps) {
  if (hops === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          This signal lands directly on <span className="font-medium text-foreground">{serviceName}</span>&apos;s own
          technology.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 rounded-md border border-border bg-secondary px-4 py-3 text-center">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {landedKind === 'infrastructure' ? 'Shared Infrastructure' : 'Service'}
          </p>
          <p className="mt-1 font-semibold">{humanizeSlug(landedOn)}</p>
        </div>

        <div className="flex flex-col items-center px-2">
          <span
            className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              dependency?.criticality === 'hard'
                ? 'bg-status-critical/20 text-status-critical'
                : 'bg-status-at-risk/20 text-status-at-risk'
            }`}
          >
            {dependency?.criticality ?? 'unknown'}
          </span>
          <span className="my-1 h-px w-10 bg-border sm:w-16" />
          <span className="text-[10px] text-muted-foreground">1 hop</span>
        </div>

        <div className="flex-1 rounded-md border-2 border-status-critical/60 bg-secondary px-4 py-3 text-center">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Reaches</p>
          <p className="mt-1 font-semibold">{serviceName}</p>
        </div>
      </div>

      {dependency && <p className="mt-4 text-sm text-muted-foreground">{dependency.rationale}</p>}

      {otherAffectedServices.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {otherAffectedServices.length} other service{otherAffectedServices.length === 1 ? '' : 's'} depend
            {otherAffectedServices.length === 1 ? 's' : ''} on this same tier:
          </span>
          {otherAffectedServices.map((slug) => (
            <Badge key={slug} variant="outline" className="text-xs">
              {humanizeSlug(slug)}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
