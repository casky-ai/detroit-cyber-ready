// "List all the websites and assets" for a service, on request (e.g. a map
// marker click) — no scanning happens here, this reads the declared
// (synthetic) technology inventory and the shared infrastructure the
// service depends on. See docs/connectors.md: we do not scan cities.

import { NextResponse } from 'next/server';
import { getDetroitInventory } from '@/lib/detroit';

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export async function GET(_req: Request, { params }: RouteParams) {
  const { slug } = await params;
  const { services, infrastructure, dependencies, technologies } = await getDetroitInventory();

  const service = services.find((s) => s.slug === slug);
  if (!service) {
    return NextResponse.json({ error: 'service not found' }, { status: 404 });
  }

  const ownTechnology = technologies.filter((t) => t.service_slug === slug);

  const serviceDependencies = dependencies
    .filter((d) => d.service_slug === slug)
    .map((d) => {
      const infra = infrastructure.find((i) => i.slug === d.infrastructure_slug);
      const infraTech = technologies.filter((t) => t.infrastructure_slug === d.infrastructure_slug);
      return {
        infrastructure_slug: d.infrastructure_slug,
        infrastructure_name: infra?.name ?? d.infrastructure_slug,
        kind: d.kind,
        criticality: d.criticality,
        rationale: d.rationale,
        technology: infraTech,
      };
    });

  return NextResponse.json({
    service: { slug: service.slug, name: service.name, address: service.address },
    own_technology: ownTechnology,
    shared_infrastructure: serviceDependencies,
  });
}
