// Fingerprinting and dedupe. Every RawSignal that reaches storage has passed
// through here, regardless of which source produced it.

import { createHash } from 'node:crypto';
import type { RawSignal } from './contracts';

/**
 * A stable identity for a signal, independent of when we polled it.
 * Re-polling the same feed twice must produce the same fingerprint so the
 * upsert into `signals` is a no-op the second time, not a duplicate row.
 */
export function fingerprintSignal(signal: RawSignal): string {
  const material = [
    signal.source,
    signal.external_id,
    signal.kind,
    // Included because the same external_id can mean different things across
    // sources (a KEV addition vs. an NVD record for the same CVE are
    // different facts about the same identifier).
    signal.vendor_project ?? '',
    signal.product ?? '',
  ].join('|');
  return createHash('sha256').update(material).digest('hex');
}

/**
 * Dedupe a batch of signals by fingerprint, keeping the first occurrence.
 * Does not touch anything already in storage — that upsert is the caller's
 * job, keyed on the same fingerprint.
 */
export function dedupeSignals(signals: RawSignal[]): RawSignal[] {
  const seen = new Set<string>();
  const out: RawSignal[] = [];
  for (const signal of signals) {
    const fp = fingerprintSignal(signal);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(signal);
  }
  return out;
}
