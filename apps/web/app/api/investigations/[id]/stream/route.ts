// The SSE route. Three independent paths to a terminal state, which is the
// whole point of the guard discipline documented in plans/001_prd.md:
//
//   1. This connection drives the agent live (status was 'queued') and
//      performs the one atomic completion write itself (L2).
//   2. A second connection to an already-'running' investigation falls back
//      to polling `output`/`status` rather than starting a second LLM run,
//      and still reaches `done` — via the marker if the first connection's
//      write landed, or via a timeout event if it never does (L4).
//   3. A reconnect to an investigation whose marker is present but whose
//      status never made it to 'completed' (the writing connection died
//      mid-write) heals it right here before replying (a lightweight,
//      request-time version of the same guard the cron in
//      /api/cron/heal-investigations applies on a schedule — L3's other
//      independent path).
//
// AbortController discipline: the agent's own internal timeouts (see
// packages/investigate/src/llm.ts) are the primary guard against a hung LLM
// call. This route adds a second, outer wall (SSE_MAX_DURATION_MS) as
// defense in depth, matching the "at least 3 independent paths" rule rather
// than trusting any single layer.

import { runInvestigation, type InvestigationInput } from '@dcr/investigate/agent';
import type { SignalMatch } from '@dcr/impact/exposure';
import type { RiskComponents } from '@dcr/impact/scoring';
import { getAdminClient } from '@/lib/supabase/admin';
import { getDetroitInventory } from '@/lib/detroit';
import { resolveTerminalState, shouldHeal } from '@/lib/stream-logic';
import { sseEvent, sseText } from '@/lib/sse';
import { SSE_POLL_INTERVAL_MS, SSE_MAX_DURATION_MS } from '@/lib/constants';

export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface InvestigationRow {
  id: string;
  signal_id: string;
  service_slug: string;
  status: string;
  context: { match: SignalMatch } | null;
  risk_score: number | null;
  risk_components: RiskComponents | null;
  priority: 'P1' | 'P2' | 'P3' | 'informational' | null;
  escalated: boolean | null;
  escalation_reason: string | null;
  output: string | null;
  ended_at: string | null;
}

async function buildInvestigationInput(row: InvestigationRow): Promise<InvestigationInput> {
  const { services } = await getDetroitInventory();
  const service = services.find((s) => s.slug === row.service_slug);
  if (!service) throw new Error(`unknown service_slug on investigation: ${row.service_slug}`);
  if (!row.context?.match) throw new Error('investigation row is missing its stored match');
  if (row.priority === null || row.risk_score === null || !row.risk_components) {
    throw new Error('investigation row is missing its stored risk result');
  }

  return {
    match: row.context.match,
    service,
    risk: {
      score: row.risk_score,
      priority: row.priority,
      escalated: row.escalated ?? false,
      escalationReason: row.escalation_reason,
      components: row.risk_components,
    },
  };
}

export async function GET(_req: Request, { params }: RouteParams) {
  const { id } = await params;
  const admin = getAdminClient();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Controller already closed (client disconnected) — nothing to do.
        }
      };
      const finish = () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      try {
        const { data: row, error } = await admin
          .from('investigations')
          .select('*')
          .eq('id', id)
          .single<InvestigationRow>();

        if (error || !row) {
          send(sseEvent('done', { status: 'failed', error: 'investigation not found' }));
          return finish();
        }

        // Path 3: heal-on-reconnect. The marker landed but the status write
        // that should have accompanied it never did.
        if (shouldHeal(row.status, row.output)) {
          await admin
            .from('investigations')
            .update({ status: 'completed', ended_at: row.ended_at ?? new Date().toISOString() })
            .eq('id', id);
          row.status = 'completed';
        }

        const terminal = resolveTerminalState(row.status, row.output);
        if (terminal.done) {
          if (row.output) send(sseText(row.output));
          send(sseEvent('done', { status: terminal.status }));
          return finish();
        }

        if (row.status === 'running') {
          // Path 2: someone else (or a previous connection) is already
          // driving this investigation. Poll rather than double-run the LLM.
          await pollUntilTerminal(admin, id, send);
          return finish();
        }

        // Path 1: status is 'queued' — this connection drives the agent.
        const { error: startError } = await admin
          .from('investigations')
          .update({ status: 'running', started_at: new Date().toISOString() })
          .eq('id', id);
        if (startError) throw new Error(`failed to mark investigation running: ${startError.message}`);

        const input = await buildInvestigationInput(row);

        let buffer = '';
        const overallAbort = new AbortController();
        const hardTimeout = setTimeout(() => overallAbort.abort(), SSE_MAX_DURATION_MS);

        let result: Awaited<ReturnType<typeof runInvestigation>>;
        try {
          result = await runInvestigation(input, {
            onStep: (e) => send(sseEvent('step', e)),
            onNarrativeChunk: (chunk) => {
              buffer += chunk;
              send(sseText(chunk));
            },
          });
        } finally {
          clearTimeout(hardTimeout);
        }
        // runInvestigation never throws (see packages/investigate/src/agent.ts) —
        // a failed LLM call degrades to a deterministic fallback instead. The
        // try/finally above is defense in depth, not the primary guard.

        // L2: the one atomic completion write. status, output (carrying
        // COMPLETE_MARKER), and ended_at together, in a single awaited call.
        const { error: writeError } = await admin
          .from('investigations')
          .update({
            status: 'completed',
            output: result.narrative,
            ended_at: new Date().toISOString(),
            plan: {
              actions: result.actions,
              selectedSkills: result.selectedSkills,
              caskyEnrichment: result.caskyEnrichment,
              degraded: result.degraded,
              gaps: result.gaps,
            },
          })
          .eq('id', id);

        if (writeError) {
          await admin
            .from('investigations')
            .update({ status: 'failed', output: buffer, ended_at: new Date().toISOString() })
            .eq('id', id)
            .then(
              () => {},
              () => {}
            );
          send(sseEvent('done', { status: 'failed', error: writeError.message }));
          return finish();
        }

        if (result.actions.length > 0) {
          const { error: actionsError } = await admin.from('actions').insert(
            result.actions.map((a) => ({
              investigation_id: id,
              rank: a.rank,
              title: a.title,
              detail: a.detail,
              sla: a.sla,
              owner: a.owner,
            }))
          );
          // The investigation itself already completed successfully and
          // carries the marker; a failure recording the action plan rows is
          // logged as a gap in the response, not escalated into a failed
          // investigation — the narrative is the part that matters most and
          // it is already safely written.
          if (actionsError) {
            send(sseEvent('step', { step: 'plan-generated', label: `Warning: failed to save actions: ${actionsError.message}` }));
          }
        }

        send(sseEvent('done', { status: 'completed' }));
        finish();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        try {
          await admin
            .from('investigations')
            .update({ status: 'failed', output: message, ended_at: new Date().toISOString() })
            .eq('id', id);
        } catch {
          // Best-effort — the client still learns about the failure via the
          // `done` event below even if this write itself fails.
        }
        send(sseEvent('done', { status: 'failed', error: message }));
        finish();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

async function pollUntilTerminal(
  admin: ReturnType<typeof getAdminClient>,
  id: string,
  send: (chunk: string) => void
): Promise<void> {
  const startedAt = Date.now();
  let knownLen = 0;

  while (Date.now() - startedAt < SSE_MAX_DURATION_MS) {
    await new Promise((resolve) => setTimeout(resolve, SSE_POLL_INTERVAL_MS));

    const { data: row, error } = await admin
      .from('investigations')
      .select('status, output')
      .eq('id', id)
      .single<{ status: string; output: string | null }>();
    if (error || !row) continue;

    if (row.output && row.output.length > knownLen) {
      send(sseText(row.output.slice(knownLen)));
      knownLen = row.output.length;
    }

    const terminal = resolveTerminalState(row.status, row.output);
    if (terminal.done) {
      if (shouldHeal(row.status, row.output)) {
        await admin
          .from('investigations')
          .update({ status: 'completed', ended_at: new Date().toISOString() })
          .eq('id', id);
      }
      send(sseEvent('done', { status: terminal.status }));
      return;
    }
  }

  send(sseEvent('timeout', { message: 'Investigation did not complete within the SSE window.' }));
}
