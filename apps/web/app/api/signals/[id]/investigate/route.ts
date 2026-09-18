// General-purpose investigation trigger: given a signal already in the
// database (from a real /api/signals/poll run, not the demo path), match it
// against the Detroit inventory and create an investigation for a specific
// affected service. This is what the signal feed UI calls when a viewer
// clicks "Investigate" on a real, live-polled signal.

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { startInvestigation } from '@/lib/investigation-start';
import type { RawSignal } from '@dcr/signals/contracts';

export const maxDuration = 30;

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface InvestigateRequestBody {
  targetServiceSlug: string;
}

export async function POST(req: Request, { params }: RouteParams) {
  const { id } = await params;

  let body: Partial<InvestigateRequestBody>;
  try {
    body = (await req.json()) as Partial<InvestigateRequestBody>;
  } catch {
    return NextResponse.json({ error: 'request body must be JSON with targetServiceSlug' }, { status: 400 });
  }
  if (!body.targetServiceSlug) {
    return NextResponse.json({ error: 'targetServiceSlug is required' }, { status: 400 });
  }

  const admin = getAdminClient();
  const { data: signalRow, error: signalError } = await admin.from('signals').select('*').eq('id', id).single();
  if (signalError || !signalRow) {
    return NextResponse.json({ error: 'signal not found' }, { status: 404 });
  }

  const signal: RawSignal = {
    source: signalRow.source,
    provenance: signalRow.provenance,
    external_id: signalRow.external_id,
    kind: signalRow.kind,
    title: signalRow.title,
    summary: signalRow.summary,
    published_at: signalRow.published_at,
    severity: signalRow.severity,
    vendor_project: signalRow.vendor_project,
    product: signalRow.product,
    cpe: signalRow.cpe,
    cvss_score: signalRow.cvss_score,
    epss_percentile: signalRow.epss_percentile,
    raw: signalRow.raw,
  };

  try {
    const started = await startInvestigation({
      signal,
      signalId: id,
      targetServiceSlug: body.targetServiceSlug,
    });

    return NextResponse.json(
      {
        investigation_id: started.investigationId,
        landed_on: started.match.landedOn,
        hops: started.match.hops,
        dependency: started.match.dependency,
        risk: started.risk,
        other_affected_services: started.otherAffectedServices,
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
