import { describe, it, expect, beforeAll } from 'vitest';
import { loadDetroitInventory, type DetroitInventory } from '@dcr/impact/data';
import type { RawSignal } from '@dcr/signals';
import { assessKevCatalog } from '../lib/kev-live';

// Real CISA KEV records, copied verbatim from the catalog (version
// 2026.09.18), run against the real Detroit inventory in data/detroit/.
const REAL_KEV = [
  { cveID: 'CVE-2023-46805', vendorProject: 'Ivanti', product: 'Connect Secure and Policy Secure', vulnerabilityName: 'Ivanti Connect Secure and Policy Secure Authentication Bypass Vulnerability', dateAdded: '2024-01-10', knownRansomwareCampaignUse: 'Known' },
  { cveID: 'CVE-2020-8218', vendorProject: 'Pulse Secure', product: 'Pulse Connect Secure', vulnerabilityName: 'Pulse Connect Secure Code Injection Vulnerability', dateAdded: '2022-03-07', knownRansomwareCampaignUse: 'Unknown' },
  { cveID: 'CVE-2017-6742', vendorProject: 'Cisco', product: 'IOS and IOS XE Software', vulnerabilityName: 'Cisco IOS and IOS XE Software SNMP Remote Code Execution Vulnerability', dateAdded: '2023-04-19', knownRansomwareCampaignUse: 'Unknown' },
  { cveID: 'CVE-2022-20821', vendorProject: 'Cisco', product: 'IOS XR', vulnerabilityName: 'Cisco IOS XR Open Port Vulnerability', dateAdded: '2022-05-23', knownRansomwareCampaignUse: 'Unknown' },
  { cveID: 'CVE-2024-21182', vendorProject: 'Oracle', product: 'WebLogic Server', vulnerabilityName: 'Oracle WebLogic Server Unspecified Vulnerability', dateAdded: '2026-06-01', knownRansomwareCampaignUse: 'Unknown' },
  { cveID: 'CVE-2026-6973', vendorProject: 'Ivanti', product: 'Endpoint Manager Mobile (EPMM)', vulnerabilityName: 'Ivanti Endpoint Manager Mobile (EPMM) Improper Input Validation Vulnerability', dateAdded: '2026-05-07', knownRansomwareCampaignUse: 'Unknown' },
  { cveID: 'CVE-2025-39964', vendorProject: 'Linux', product: 'Kernel', vulnerabilityName: 'Linux Kernel Race Condition Vulnerability', dateAdded: '2026-09-18', knownRansomwareCampaignUse: 'Unknown' },
];

const toSignal = (e: (typeof REAL_KEV)[number]): RawSignal => ({
  source: 'cisa-kev',
  provenance: 'live',
  external_id: e.cveID,
  kind: 'kev-addition',
  title: e.vulnerabilityName,
  summary: null,
  published_at: `${e.dateAdded}T00:00:00.000Z`,
  severity: null,
  vendor_project: e.vendorProject,
  product: e.product,
  cpe: null,
  cvss_score: null,
  epss_percentile: null,
  raw: e,
});

let inventory: DetroitInventory;
beforeAll(async () => {
  inventory = await loadDetroitInventory();
});

const assess = () => assessKevCatalog(REAL_KEV.map(toSignal), inventory, { newest: 3 });
const row = (cve: string) => assess().newest.concat(assess().reaching).find((r) => r.cve === cve);

describe('live KEV check against the Detroit inventory', () => {
  it("reaches 911 from the demo CVE's real CISA record, 911 first", () => {
    const r = row('CVE-2023-46805')!;
    expect(r.reaches.map((x) => x.service_slug)).toEqual(
      expect.arrayContaining(['911-emergency-communications', 'police', 'water', 'payments', 'courts'])
    );
    expect(r.reaches[0].service_slug).toBe('911-emergency-communications');
    expect(r.reaches[0]).toMatchObject({ hops: 1, landed_on: 'remote-access', matched_phrase: 'connect secure' });
    expect(r.ransomware).toBe(true);
  });

  it('reaches the network core, and 911 through it, from a real IOS XE entry', () => {
    const r = row('CVE-2017-6742')!;
    expect(r.reaches.some((x) => x.landed_on === 'network-core')).toBe(true);
    expect(r.reaches[0].service_slug).toBe('911-emergency-communications');
  });

  it('reaches Water directly from a real WebLogic Server entry', () => {
    expect(row('CVE-2024-21182')!.reaches).toEqual([
      expect.objectContaining({ service_slug: 'water', hops: 0 }),
    ]);
  });

  it('reports no exposure for products Detroit does not run', () => {
    const { reaching } = assess();
    const reached = reaching.map((r) => r.cve);
    expect(reached).not.toContain('CVE-2022-20821'); // IOS XR is not IOS XE
    expect(reached).not.toContain('CVE-2026-6973'); // EPMM is not Connect Secure
    expect(reached).not.toContain('CVE-2025-39964'); // Linux kernel
    // Filed under the pre-acquisition vendor name; without version-aware
    // matching we do not claim a 2020 flaw affects the version Detroit runs.
    expect(reached).not.toContain('CVE-2020-8218');
  });

  it('lists the newest additions first and counts everything that reaches Detroit', () => {
    const a = assess();
    expect(a.total).toBe(7);
    expect(a.newest.map((r) => r.cve)).toEqual(['CVE-2025-39964', 'CVE-2024-21182', 'CVE-2026-6973']);
    expect(a.reaching_total).toBe(3);
  });
});
