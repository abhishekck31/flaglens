// CI only: turns a brand-new, empty self-hosted Flagsmith into one we can seed.
// Does what quickstart step 2 does by hand in the dashboard: sign up the first (admin) user,
// create an organisation, create an Organisation API key. Same API calls the dashboard makes
// (checked against Flagsmith 2.295.2).
//
// Writes FLAGSMITH_API_KEY and FLAGLENS_API_KEY to $GITHUB_ENV so later steps can use them,
// and masks the key so it never appears in logs. Refuses to run outside GitHub Actions.

import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";

if (process.env.GITHUB_ACTIONS !== "true" || !process.env.GITHUB_ENV) {
  console.error("ci-bootstrap.mjs only runs inside GitHub Actions, against a throwaway Flagsmith.");
  process.exitCode = 2;
} else {
  await bootstrap();
}

async function bootstrap() {
  const base = "http://localhost:8000/api/v1";
  const post = async (path, body, token) => {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Token ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`POST ${path} -> ${res.status} ${JSON.stringify(json)}`);
    return json;
  };

  // Random password, never printed: nobody logs in to this instance; it dies with the job.
  const password = randomBytes(18).toString("base64url");
  const user = await post("/auth/users/", { email: "ci@flaglens.test", password, first_name: "CI", last_name: "Bot" });
  const org = await post("/organisations/", { name: "FlagLens CI" }, user.key);
  const apiKey = await post(`/organisations/${org.id}/master-api-keys/`, { name: "flaglens-ci", is_admin: true }, user.key);

  console.log(`::add-mask::${apiKey.key}`); // hide the key in all later log output
  appendFileSync(process.env.GITHUB_ENV, `FLAGSMITH_API_KEY=${apiKey.key}\nFLAGLENS_API_KEY=${apiKey.key}\n`);
  console.log(`Created organisation "${org.name}" and an Organisation API key.`);
}
