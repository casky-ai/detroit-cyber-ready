import { describe, it, expect } from 'vitest';
import { diffSurface } from '../src/surface-diff';
import { makeSyntheticSurfaceSource } from '../src/sources/synthetic-surface';
import type { SurfaceObservation } from '../src/contracts';

function makeObservation(overrides: Partial<SurfaceObservation> = {}): SurfaceObservation {
  return {
    host: 'svc.city-network.example',
    ip: '198.51.100.5',
    port: 443,
    transport: 'tcp',
    service: 'https',
    vendor: 'Acme',
    product: 'Widget',
    version: '1.0.0',
    cpe: null,
    tls_cert_sha256: 'a'.repeat(64),
    tls_not_after: '2027-01-01T00:00:00.000Z',
    banner: null,
    observed_at: '2026-09-17T00:00:00.000Z',
    ...overrides,
  };
}

describe('diffSurface', () => {
  it('produces zero diffs for unchanged input', () => {
    const snapshot = [makeObservation()];
    expect(diffSurface(snapshot, snapshot)).toEqual([]);
    // Also true across two structurally-identical-but-distinct arrays.
    expect(diffSurface([makeObservation()], [makeObservation()])).toEqual([]);
  });

  it('detects a new host', () => {
    const before = [makeObservation({ host: 'a.example', port: 443 })];
    const after = [
      makeObservation({ host: 'a.example', port: 443 }),
      makeObservation({ host: 'b.example', port: 443 }),
    ];
    const changes = diffSurface(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('new-host');
    expect(changes[0].after?.host).toBe('b.example');
  });

  it('distinguishes a new service on a known host from a new host', () => {
    const before = [makeObservation({ host: 'a.example', port: 443 })];
    const after = [
      makeObservation({ host: 'a.example', port: 443 }),
      makeObservation({ host: 'a.example', port: 8443 }),
    ];
    const changes = diffSurface(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('new-service');
  });

  it('detects a version change', () => {
    const before = [makeObservation({ version: '1.0.0' })];
    const after = [makeObservation({ version: '1.0.1' })];
    const changes = diffSurface(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('version-changed');
  });

  it('detects a certificate change', () => {
    const before = [makeObservation({ tls_cert_sha256: 'a'.repeat(64) })];
    const after = [makeObservation({ tls_cert_sha256: 'b'.repeat(64) })];
    const changes = diffSurface(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('certificate-changed');
  });

  it('detects a removed host as removed-service, not silently dropped', () => {
    const before = [makeObservation({ host: 'a.example' })];
    const after: SurfaceObservation[] = [];
    const changes = diffSurface(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('removed-service');
    expect(changes[0].before?.host).toBe('a.example');
  });

  it('matches the committed demo snapshots: one new host, one version change', async () => {
    const source = makeSyntheticSurfaceSource();
    const t0 = await source.snapshot({ snapshotId: 't0' });
    const t1 = await source.snapshot({ snapshotId: 't1' });
    expect(t0.observations.length).toBeGreaterThan(0);

    const changes = diffSurface(t0.observations, t1.observations);
    const kinds = changes.map((c) => c.kind).sort();
    expect(kinds).toEqual(['new-host', 'version-changed']);
  });
});
