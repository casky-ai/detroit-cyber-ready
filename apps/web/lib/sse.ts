// Server-Sent Events frame formatting. Two shapes only: unnamed `data`
// frames carry incremental output text, named `event: X` frames carry
// structured events (`step`, `done`, `timeout`). Kept this small
// deliberately — the vocabulary in docs/connectors.md and the PRD is
// exactly these three named events plus the unnamed text frame.

export function sseText(text: string): string {
  return `data: ${JSON.stringify({ text })}\n\n`;
}

export function sseEvent(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}
