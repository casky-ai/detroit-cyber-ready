-- Detroit Cyber Ready: initial schema.
-- Matches plans/001_prd.md "Data model" exactly.
--
-- Access model: every table is read and written exclusively by this app's
-- own Next.js API routes using the Supabase service role key, which bypasses
-- RLS by design. There is no direct client-side Supabase query anywhere in
-- this app and no anon/authenticated policy is defined on any table, so RLS
-- is enabled everywhere as defense in depth: if a table is ever exposed to
-- the Data API by mistake, the default is "nobody can read or write it,"
-- not "everybody can." See .agents/skills/supabase, security checklist #5.

create extension if not exists pgcrypto; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- City services. 911 sits in its own life-safety tier above everything else.
-- ---------------------------------------------------------------------------

create table city_services (
  slug               text primary key,
  name               text not null,
  department         text not null,
  criticality        text not null check (criticality in ('life-safety','critical','high','moderate','low')),
  -- address text not null,  -- planned; not yet applied to the live table
  -- (direct Postgres access is blocked from the build environment; the app
  -- never reads this column back anyway, see scripts/seed-detroit-data.ts)
  resident_impact    text not null,
  impact_unit        text,
  externally_exposed boolean not null default false,
  lat                numeric,
  lon                numeric,
  created_at         timestamptz not null default now()
);

alter table city_services enable row level security;

-- ---------------------------------------------------------------------------
-- Shared city infrastructure. Deliberately small — never drawn on the map,
-- never depended on by another infrastructure entry.
-- ---------------------------------------------------------------------------

create table shared_infrastructure (
  slug        text primary key,
  name        text not null,
  description text not null,
  exposure    text not null check (exposure in ('internet-facing','partner-network','internal')),
  created_at  timestamptz not null default now()
);

alter table shared_infrastructure enable row level security;

-- ---------------------------------------------------------------------------
-- Exactly one level: a city service depends on shared infrastructure.
-- No infrastructure-to-infrastructure edges. No service-to-service edges.
-- ---------------------------------------------------------------------------

create table service_dependencies (
  id                  uuid primary key default gen_random_uuid(),
  service_slug        text not null references city_services(slug) on delete cascade,
  infrastructure_slug text not null references shared_infrastructure(slug) on delete cascade,
  kind                text not null check (kind in ('reachable-via','authenticates-via','routes-over','reads-from')),
  criticality         text not null check (criticality in ('hard','soft')),
  rationale           text not null,
  created_at          timestamptz not null default now(),
  unique (service_slug, infrastructure_slug)
);

alter table service_dependencies enable row level security;

-- ---------------------------------------------------------------------------
-- The one simulated layer: vendor/product per service or infrastructure.
-- ---------------------------------------------------------------------------

create table technologies (
  id                  uuid primary key default gen_random_uuid(),
  service_slug        text references city_services(slug) on delete cascade,
  infrastructure_slug text references shared_infrastructure(slug) on delete cascade,
  vendor              text not null,
  product             text not null,
  version             text,
  cpe                 text,
  exposure            text not null check (exposure in ('internet-facing','partner-network','internal')),
  created_at          timestamptz not null default now(),
  constraint technologies_exactly_one_owner check (num_nonnulls(service_slug, infrastructure_slug) = 1)
);

alter table technologies enable row level security;

-- ---------------------------------------------------------------------------
-- External signals. source + provenance stamped on every row; fingerprint
-- makes re-polling a feed idempotent (see packages/signals/src/normalize.ts).
-- ---------------------------------------------------------------------------

create table signals (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,
  provenance    text not null check (provenance in ('live','synthetic')),
  external_id   text not null,
  fingerprint   text not null unique,
  kind          text not null check (kind in ('kev-addition','advisory','ioc','scanning-activity','surface-change')),
  title         text not null,
  summary       text,
  published_at  timestamptz not null,
  severity      text,
  vendor_project text,
  product        text,
  cpe            text,
  cvss_score     numeric(3,1),
  epss_percentile numeric(4,3),
  raw           jsonb not null,
  first_seen_at timestamptz not null default now()
);

create index signals_published_at_idx on signals (published_at desc);
create index signals_external_id_idx on signals (external_id);

alter table signals enable row level security;

-- ---------------------------------------------------------------------------
-- Point-in-time externally visible surface. Populated by any SurfaceSource,
-- synthetic today, Shodan or Censys when productized. Same shape either way.
-- ---------------------------------------------------------------------------

create table surface_observations (
  id              uuid primary key default gen_random_uuid(),
  snapshot_id     text not null,
  source_name     text not null,
  provenance      text not null check (provenance in ('live','synthetic')),
  host            text not null,
  ip              inet not null,
  port            int not null,
  transport       text not null check (transport in ('tcp','udp')),
  service         text not null,
  vendor          text not null,
  product         text not null,
  version         text,
  cpe             text,
  tls_cert_sha256 text,
  tls_not_after   timestamptz,
  banner          text,
  service_slug    text references city_services(slug),
  observed_at     timestamptz not null
);

create index surface_observations_snapshot_idx on surface_observations (snapshot_id);
create unique index surface_observations_identity_idx
  on surface_observations (snapshot_id, host, port, transport);

alter table surface_observations enable row level security;

-- ---------------------------------------------------------------------------
-- The exposure match. matched_on is the audit trail: when a CISO asks "why
-- did you flag 911," the answer is this row, not a model output.
-- ---------------------------------------------------------------------------

create table signal_matches (
  id              uuid primary key default gen_random_uuid(),
  signal_id       uuid not null references signals(id) on delete cascade,
  landed_on       text not null,
  landed_kind     text not null check (landed_kind in ('service','infrastructure')),
  service_slug    text not null references city_services(slug),
  match_basis     text not null check (match_basis in ('cpe','vendor+product','advisory-keyword','surface-host')),
  matched_on      jsonb not null,
  hops            int not null default 0 check (hops in (0,1)),
  dependency      jsonb,
  provenance      text not null check (provenance in ('live','synthetic')),
  confidence      numeric(4,3) not null,
  created_at      timestamptz not null default now(),
  unique (signal_id, landed_on, service_slug)
);

create index signal_matches_service_idx on signal_matches (service_slug);

alter table signal_matches enable row level security;

-- ---------------------------------------------------------------------------
-- Investigations. output carries COMPLETE_MARKER on success — see
-- apps/web/lib/constants.ts, the single source of truth all five layers
-- check independently.
-- ---------------------------------------------------------------------------

create table investigations (
  id               uuid primary key default gen_random_uuid(),
  signal_id        uuid not null references signals(id),
  service_slug     text not null references city_services(slug),
  status           text not null default 'queued' check (status in ('queued','running','completed','failed','stopped')),
  context          jsonb,
  plan             jsonb,
  risk_score       numeric(5,2),
  risk_components  jsonb,
  priority         text check (priority in ('P1','P2','P3','informational')),
  escalated        boolean not null default false,
  escalation_reason text,
  output           text,
  started_at       timestamptz,
  ended_at         timestamptz,
  created_at       timestamptz not null default now()
);

create index investigations_status_idx on investigations (status);
create index investigations_service_idx on investigations (service_slug);

alter table investigations enable row level security;

-- ---------------------------------------------------------------------------
-- The prioritized action plan.
-- ---------------------------------------------------------------------------

create table actions (
  id               uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references investigations(id) on delete cascade,
  rank             int not null,
  title            text not null,
  detail           text not null,
  sla              text not null check (sla in ('Now','< 1 hour','< 24 hours','Ongoing')),
  owner            text not null,
  created_at       timestamptz not null default now(),
  unique (investigation_id, rank)
);

alter table actions enable row level security;
