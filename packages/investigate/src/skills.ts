// Narrows the 818-skill corpus (upstream/skills, a pinned public submodule)
// down to the handful relevant to a given exposure, before it ever reaches
// the LLM. This is deterministic text search, not a model call: an LLM
// choosing from an 818-entry list is exactly the kind of prompt that
// invites hallucinated slugs, and there is nothing here worth spending a
// model call on when a keyword match does the job.
//
// If a future pass wants the LLM to help narrow further, this narrowed list
// (not the full corpus) is what it should see.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// packages/investigate/src -> repo root is three levels up.
const REPO_ROOT = path.resolve(HERE, '../../..');
const SKILLS_INDEX_PATH = path.join(REPO_ROOT, 'upstream/skills/index.json');

interface RawSkillEntry {
  name: string;
  description: string;
  domain: string;
  path: string;
}

interface SkillsIndexFile {
  total_skills: number;
  skills: RawSkillEntry[];
}

export interface NarrowedSkill {
  name: string;
  description: string;
}

let cache: RawSkillEntry[] | null = null;

async function loadSkillIndex(): Promise<RawSkillEntry[]> {
  if (cache) return cache;
  const raw = await readFile(SKILLS_INDEX_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as SkillsIndexFile;
  cache = parsed.skills ?? [];
  return cache;
}

/**
 * Expands an infrastructure or technology slug into the search terms a human
 * analyst would actually use to find relevant playbooks. Kept as a plain
 * lookup table rather than a model call — this almost never changes and
 * should never be a source of nondeterminism in the demo.
 */
const KEYWORD_EXPANSION: Record<string, string[]> = {
  'remote-access': ['vpn', 'remote access', 'zero trust', 'authentication bypass', 'edge device'],
  identity: ['identity', 'authentication', 'single sign-on', 'multi-factor', 'credential'],
  'network-core': ['network', 'firewall', 'routing', 'lateral movement', 'traffic analysis'],
  'records-management': ['database', 'data exposure', 'records', 'access control'],
};

const BASELINE_KEYWORDS = ['incident response', 'log analysis', 'forensics'];

export function keywordsFor(infrastructureOrServiceSlug: string, vendor: string, product: string): string[] {
  const expanded = KEYWORD_EXPANSION[infrastructureOrServiceSlug] ?? [];
  return [...expanded, ...BASELINE_KEYWORDS, vendor.toLowerCase(), product.toLowerCase()];
}

/**
 * Ranks the corpus by how many of the given keywords appear in each skill's
 * name and description, returns the top `limit`. Zero-score skills are
 * dropped entirely rather than padded in — an empty result is a legitimate
 * outcome (an evidence gap for the narrative to mention), not an error.
 */
export async function narrowSkills(keywords: string[], limit = 6): Promise<NarrowedSkill[]> {
  const index = await loadSkillIndex();
  const lowerKeywords = keywords.map((k) => k.toLowerCase()).filter((k) => k.length > 0);

  const scored = index.map((skill) => {
    const haystack = `${skill.name} ${skill.description}`.toLowerCase().replace(/-/g, ' ');
    const score = lowerKeywords.reduce((acc, kw) => acc + (haystack.includes(kw) ? 1 : 0), 0);
    return { skill, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => ({ name: s.skill.name, description: s.skill.description }));
}
