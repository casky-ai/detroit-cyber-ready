// The demo's centerpiece: two boxes, one line. Never more. If this ever
// needs a third box, that is a sign the underlying model has drifted from
// the one-hop-only design in packages/impact/src/exposure.ts; the whole
// point is that this stays legible at a glance.

import { ArrowRight, Server, Siren } from 'lucide-react';
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
      <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <p className="text-sm text-muted-foreground">
          This signal lands directly on <span className="font-medium text-foreground">{serviceName}</span>&apos;s own
          technology.
        </p>
      </div>
    );
  }

  const hard = dependency?.criticality === 'hard';

  return (
    <div className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <div className="flex-1 animate-in fade-in-0 slide-in-from-left-4 rounded-lg bg-secondary px-4 py-3 text-center ring-1 ring-foreground/10 duration-500">
          <p className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Server className="h-3.5 w-3.5" aria-hidden />
            {landedKind === 'infrastructure' ? 'Shared infrastructure' : 'Service'}
          </p>
          <p className="mt-1 font-semibold">{humanizeSlug(landedOn)}</p>
        </div>

        <div className="flex flex-row items-center justify-center gap-2 px-1 sm:flex-col sm:gap-1">
          <span
            className={`rounded px-2 py-0.5 text-xs font-semibold ${
              hard ? 'bg-status-critical/20 text-status-critical' : 'bg-status-at-risk/20 text-status-at-risk'
            }`}
          >
            {dependency?.criticality ?? 'unknown'}
          </span>
          <span className="relative hidden h-0.5 w-16 overflow-hidden rounded bg-border sm:block">
            <span
              className={`line-draw absolute inset-y-0 left-0 w-full ${
                hard ? 'bg-status-critical' : 'bg-status-at-risk'
              }`}
            />
          </span>
          <ArrowRight className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" aria-hidden />
          <span className="text-[10px] text-muted-foreground">1 hop</span>
        </div>

        <div className="flex-1 animate-in fade-in-0 slide-in-from-right-4 rounded-lg bg-status-critical/10 px-4 py-3 text-center ring-2 ring-status-critical/60 duration-500 [animation-delay:600ms] [animation-fill-mode:both]">
          <p className="flex items-center justify-center gap-1.5 text-xs font-medium text-status-critical">
            <Siren className="h-3.5 w-3.5" aria-hidden />
            Reaches
          </p>
          <p className="mt-1 font-semibold">{serviceName}</p>
        </div>
      </div>

      {dependency && (
        <blockquote className="mt-4 border-l-2 border-brand-gold/70 pl-3 text-sm text-pretty text-muted-foreground">
          {dependency.rationale}
        </blockquote>
      )}

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
