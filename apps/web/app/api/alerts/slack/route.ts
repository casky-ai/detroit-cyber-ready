// Sends the completed forensics and timeline to Slack via an incoming
// webhook. SLACK_WEBHOOK_URL is a placeholder env var — set it on Vercel
// (and in .env.local for local testing) whenever a real webhook is ready.
// Until then this degrades honestly: it reports back that no webhook is
// configured rather than pretending to have sent something.

import { NextResponse } from 'next/server';

interface AlertRequestBody {
  signal: { external_id: string; title: string; source: string };
  timeline: Array<{ time: string; label: string }>;
  investigations: Array<{
    service_name: string;
    priority: string;
    risk_score: number;
    escalated: boolean;
  }>;
}

function buildSlackBlocks(body: AlertRequestBody) {
  const worst = body.investigations.reduce((a, b) => (b.risk_score > a.risk_score ? b : a));
  const timelineText = body.timeline.map((t) => `\`${t.time}\`  ${t.label}`).join('\n');
  const servicesText = body.investigations
    .map((i) => `• *${i.service_name}* — ${i.priority}, risk ${i.risk_score}/100${i.escalated ? ' _(escalated)_' : ''}`)
    .join('\n');

  return {
    text: `🚨 Detroit Cyber Ready: ${body.signal.external_id} reaches ${body.investigations.length} city service(s), worst priority ${worst.priority}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `🚨 ${body.signal.external_id} — ${worst.priority} exposure detected` },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${body.signal.title}*\nSource: ${body.signal.source} (CISA Known Exploited Vulnerabilities catalog)`,
        },
      },
      { type: 'section', text: { type: 'mrkdwn', text: `*Affected services*\n${servicesText}` } },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: `*Investigation timeline*\n${timelineText}` } },
    ],
  };
}

export async function POST(req: Request) {
  const body = (await req.json()) as AlertRequestBody;
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    return NextResponse.json(
      {
        sent: false,
        reason: 'Slack delivery is off because SLACK_WEBHOOK_URL is not set. Add it in the Vercel project settings to send real alerts.',
        preview: buildSlackBlocks(body),
      },
      { status: 200 }
    );
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSlackBlocks(body)),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ sent: false, reason: `Slack responded ${res.status}: ${text}` }, { status: 200 });
    }
    return NextResponse.json({ sent: true });
  } catch (err) {
    return NextResponse.json(
      { sent: false, reason: err instanceof Error ? err.message : String(err) },
      { status: 200 }
    );
  }
}
