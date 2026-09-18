import { describe, it, expect } from 'vitest';
import { loadDetroitInventory, validateInventory } from '../src/data';

describe('Detroit inventory data', () => {
  it('parses all four files against their schemas', async () => {
    const inv = await loadDetroitInventory();
    expect(inv.services.length).toBeGreaterThan(0);
    expect(inv.infrastructure.length).toBeGreaterThan(0);
    expect(inv.dependencies.length).toBeGreaterThan(0);
    expect(inv.technologies.length).toBeGreaterThan(0);
  });

  it('has referential integrity across all four files', async () => {
    const inv = await loadDetroitInventory();
    expect(validateInventory(inv)).toEqual([]);
  });

  it('has exactly twelve city services', async () => {
    const { services } = await loadDetroitInventory();
    expect(services).toHaveLength(12);
  });

  it('has exactly one life-safety service: 911', async () => {
    const { services } = await loadDetroitInventory();
    const lifeSafety = services.filter((s) => s.criticality === 'life-safety');
    expect(lifeSafety).toHaveLength(1);
    expect(lifeSafety[0].slug).toBe('911-emergency-communications');
    expect(lifeSafety[0].impact_unit).toBe('dispatch delay and response time');
  });

  it('keeps shared infrastructure small: no more than five entries', async () => {
    const { infrastructure } = await loadDetroitInventory();
    expect(infrastructure.length).toBeLessThanOrEqual(5);
  });

  it('911 depends on remote-access, identity, and network-core as hard dependencies, and records-management as soft', async () => {
    const { dependencies } = await loadDetroitInventory();
    const nineOneOne = dependencies.filter((d) => d.service_slug === '911-emergency-communications');
    expect(nineOneOne).toHaveLength(4);

    const hard = nineOneOne.filter((d) => d.criticality === 'hard').map((d) => d.infrastructure_slug).sort();
    expect(hard).toEqual(['identity', 'network-core', 'remote-access']);

    const soft = nineOneOne.filter((d) => d.criticality === 'soft').map((d) => d.infrastructure_slug);
    expect(soft).toEqual(['records-management']);
  });

  it('remote-access has more than one dependent service, so a shared-infrastructure hit has a real blast radius', async () => {
    const { dependencies } = await loadDetroitInventory();
    const dependents = dependencies.filter((d) => d.infrastructure_slug === 'remote-access');
    expect(dependents.length).toBeGreaterThan(1);
  });

  it('the remote-access technology matches the CVE-2023-46805 fixture used across the test suite', async () => {
    const { technologies } = await loadDetroitInventory();
    const remoteAccess = technologies.find((t) => t.infrastructure_slug === 'remote-access');
    expect(remoteAccess?.vendor).toBe('Ivanti');
    expect(remoteAccess?.product).toBe('Connect Secure');
  });

  it('every technology row attaches to exactly one of service or infrastructure', async () => {
    const { technologies } = await loadDetroitInventory();
    for (const tech of technologies) {
      const attachments = [tech.service_slug, tech.infrastructure_slug].filter(Boolean);
      expect(attachments).toHaveLength(1);
    }
  });
});
