// Live check of the client against a running Flagsmith (no VS Code needed).
// Usage: FLAGLENS_API_KEY=<organisation key> npm run smoke
// Optional: FLAGLENS_API_URL (default http://localhost:8000/api/v1/)

import { FlagsmithClient } from "../src/flagsmithClient.ts";
import { describeFlag, isProductionName } from "../src/format.ts";

const apiKey = process.env.FLAGLENS_API_KEY;
if (!apiKey) {
  console.error("Set FLAGLENS_API_KEY to your Organisation API key.");
  process.exit(1);
}

const client = new FlagsmithClient(process.env.FLAGLENS_API_URL ?? "http://localhost:8000/api/v1/", apiKey);

const organisations = await client.listOrganisations();
console.log("Organisations:", organisations.map((o) => o.name));

for (const project of await client.listProjects()) {
  // Prints the same rows the sidebar tree shows.
  console.log(project.name);
  for (const env of await client.listEnvironments(project.id)) {
    const tags = [isProductionName(env.name) ? "production" : "", env.use_v2_feature_versioning ? "v2 versioning" : ""];
    console.log(`  ${env.name}  ${tags.filter(Boolean).join(", ")}`);
    for (const feature of await client.listFeatures(project.id, env.id)) {
      console.log(`    ${feature.name}  ${describeFlag(feature)}`);
    }
  }
}
