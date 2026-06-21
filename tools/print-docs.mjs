/** Print the Swagger UI URL for every service. Run: pnpm docs (after pnpm start:all). */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const services = JSON.parse(readFileSync(join(here, 'gateway', 'services.json'), 'utf8'));

console.log('\n  VelChat — API docs (Swagger UI, served by each running service):\n');
for (const s of services) {
  console.log(`   ${s.name.padEnd(24)} http://localhost:${s.http}/docs        (OpenAPI JSON: /docs-json)`);
}
console.log('\n  Start the services first:  pnpm start:all   (then open any URL above)\n');
