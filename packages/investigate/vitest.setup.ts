// Loads the repo-root .env.local for the ONE test file that makes real
// Anthropic calls (agent.integration.test.ts). Deliberately silent if the
// file is missing: dotenv's config() never throws on a missing path, it
// just returns an error object nobody here reads. A fresh clone without
// secrets gets a skipped integration test, not a broken test suite.
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, '../../.env.local') });
