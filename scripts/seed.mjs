import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(ROOT_DIR, "flagsmith.env"));

const FLAGSMITH_URL = (process.env.FLAGSMITH_API_URL || "http://localhost:8000").replace(/\/+$/, "");
const API_BASE = `${FLAGSMITH_URL}/api/v1`;
const MASTER_KEY = process.env.FLAGSMITH_API_KEY_localhost_8000 || process.env.FLAGSMITH_API_KEY;

if (!MASTER_KEY) {
  console.error("Missing FLAGSMITH_API_KEY_localhost_8000 (or FLAGSMITH_API_KEY) in flagsmith.env or environment.");
  process.exit(1);
}

async function api(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Api-Key ${MASTER_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    throw new Error(`${options.method || "GET"} ${url} failed (${res.status}): ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
}

function listResults(payload) {
  return Array.isArray(payload) ? payload : payload?.results || [];
}

async function ensureOrgProjectEnvs() {
  const orgs = listResults(await api("/organisations/"));
  let org = orgs[0];
  if (!org) {
    org = await api("/organisations/", {
      method: "POST",
      body: JSON.stringify({ name: "Toggle Wars" }),
    });
    console.log(`Created organisation: ${org.name} (id=${org.id})`);
  } else {
    console.log(`Found organisation: ${org.name} (id=${org.id})`);
  }

  const projects = listResults(await api("/projects/"));
  let project = projects[0];
  if (!project) {
    project = await api("/projects/", {
      method: "POST",
      body: JSON.stringify({ name: "Toggle Wars", organisation: org.id }),
    });
    console.log(`Created project: ${project.name} (id=${project.id})`);
  } else {
    console.log(`Found project: ${project.name} (id=${project.id})`);
  }

  const envs = listResults(await api(`/environments/?project=${project.id}`));
  let devEnv = envs.find((e) => e.name === "Development");
  if (!devEnv) {
    devEnv = await api("/environments/", {
      method: "POST",
      body: JSON.stringify({ name: "Development", project: project.id }),
    });
    console.log(`Created environment: Development (api_key=${devEnv.api_key})`);
  } else {
    console.log(`Found environment: Development (api_key=${devEnv.api_key})`);
  }

  let prodEnv = envs.find((e) => e.name === "Production");
  if (!prodEnv) {
    prodEnv = await api("/environments/", {
      method: "POST",
      body: JSON.stringify({ name: "Production", project: project.id }),
    });
    console.log(`Created environment: Production (api_key=${prodEnv.api_key})`);
  } else {
    console.log(`Found environment: Production (api_key=${prodEnv.api_key})`);
  }

  return { org, project, devEnv, prodEnv };
}

async function getFeatures(projectId) {
  return listResults(await api(`/projects/${projectId}/features/`));
}

async function ensureMultivariateFeature(projectId) {
  const desiredOptions = [
    { key: "urgent_copy", string_value: "Complete Order Now ->" },
    { key: "social_proof", string_value: "Join 12,400+ Builders ->" },
  ];

  const features = await getFeatures(projectId);
  let feature = features.find((f) => f.name === "checkout_cta_variant");

  if (!feature) {
    feature = await api(`/projects/${projectId}/features/`, {
      method: "POST",
      body: JSON.stringify({
        name: "checkout_cta_variant",
        type: "MULTIVARIATE",
        initial_value: "control",
        default_enabled: true,
        multivariate_options: desiredOptions.map((opt) => ({
          type: "unicode",
          string_value: opt.string_value,
          default_percentage_allocation: 0,
          key: opt.key,
        })),
      }),
    });
    console.log(`Created multivariate feature: ${feature.name} (id=${feature.id})`);
  } else {
    console.log(`Found multivariate feature: ${feature.name} (id=${feature.id})`);
  }

  // Flagsmith ignores `key` on nested multivariate_options during feature POST,
  // so ensure each option's `key` is explicitly set via the mv-options endpoint.
  const options = feature.multivariate_options || [];
  for (const desired of desiredOptions) {
    const match = options.find((o) => o.key === desired.key || o.string_value === desired.string_value);
    if (match && match.key !== desired.key) {
      const updated = await api(`/projects/${projectId}/features/${feature.id}/mv-options/${match.id}/`, {
        method: "PUT",
        body: JSON.stringify({
          feature: feature.id,
          type: match.type || "unicode",
          string_value: desired.string_value,
          default_percentage_allocation: match.default_percentage_allocation ?? 0,
          key: desired.key,
        }),
      });
      match.key = updated.key;
      console.log(`Set key=${updated.key} on multivariate option id=${updated.id}`);
    }
  }

  return feature;
}

async function setFeatureState(envApiKey, featureId, enabled) {
  const states = listResults(await api(`/environments/${envApiKey}/featurestates/?feature=${featureId}`));
  const state = states.find((s) => s.feature === featureId && !s.feature_segment && !s.identity);
  if (!state) {
    throw new Error(`Feature state not found for feature=${featureId} in env=${envApiKey}`);
  }
  if (state.enabled !== enabled) {
    await api(`/environments/${envApiKey}/featurestates/${state.id}/`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    });
  }
}

async function ensureBooleanFeature(projectId, devEnvKey, prodEnvKey) {
  const features = await getFeatures(projectId);
  let feature = features.find((f) => f.name === "enable_express_checkout");

  if (!feature) {
    feature = await api(`/projects/${projectId}/features/`, {
      method: "POST",
      body: JSON.stringify({
        name: "enable_express_checkout",
        type: "STANDARD",
        default_enabled: false,
      }),
    });
    console.log(`Created boolean feature: ${feature.name} (id=${feature.id})`);
  } else {
    console.log(`Found boolean feature: ${feature.name} (id=${feature.id})`);
  }

  await setFeatureState(devEnvKey, feature.id, true);
  await setFeatureState(prodEnvKey, feature.id, false);
  console.log(`Configured ${feature.name}: Development=enabled, Production=disabled`);
  return feature;
}

async function ensureExperimentMetric(devEnvKey) {
  const metrics = listResults(await api(`/environments/${devEnvKey}/experiment-metrics/`));
  let metric = metrics.find(
    (m) => m.definition?.event === "checkout_clicked" || m.name === "Checkout CTA Clicked"
  );

  if (!metric) {
    metric = await api(`/environments/${devEnvKey}/experiment-metrics/`, {
      method: "POST",
      body: JSON.stringify({
        name: "Checkout CTA Clicked",
        aggregation: "occurrence",
        direction: "up",
        definition: { version: 1, event: "checkout_clicked" },
      }),
    });
    console.log(`Created experiment metric: ${metric.name} (id=${metric.id})`);
  } else {
    console.log(`Found experiment metric: ${metric.name} (id=${metric.id})`);
  }

  return metric;
}

async function ensureAndStartExperiment(devEnvKey, feature, metric) {
  const experiments = listResults(await api(`/environments/${devEnvKey}/experiments/`));
  let experiment = experiments.find(
    (e) => (e.feature?.id ?? e.feature) === feature.id || e.name === "Checkout CTA Copy Experiment"
  );

  if (!experiment) {
    const options = feature.multivariate_options || [];
    const urgentOpt = options.find((o) => o.key === "urgent_copy");
    const socialOpt = options.find((o) => o.key === "social_proof");
    if (!urgentOpt || !socialOpt) {
      throw new Error(
        `Missing keyed multivariate options on ${feature.name}: ${JSON.stringify(options)}`
      );
    }

    experiment = await api(`/environments/${devEnvKey}/experiments/`, {
      method: "POST",
      body: JSON.stringify({
        feature: feature.id,
        name: "Checkout CTA Copy Experiment",
        hypothesis: "Urgent or social-proof CTA copy increases checkout clicks over control.",
        metrics: [
          {
            metric: metric.id,
            expected_direction: "increase",
          },
        ],
        experiment_rollout: {
          enabled: true,
          rollout_percentage: 100,
          feature_state_value: {
            type: "string",
            value: "control",
          },
          multivariate_feature_state_values: [
            {
              multivariate_feature_option: urgentOpt.id,
              percentage_allocation: 33,
            },
            {
              multivariate_feature_option: socialOpt.id,
              percentage_allocation: 33,
            },
          ],
        },
      }),
    });
    console.log(`Created experiment: ${experiment.name} (id=${experiment.id}, status=${experiment.status})`);
  } else {
    console.log(`Found experiment: ${experiment.name} (id=${experiment.id}, status=${experiment.status})`);
  }

  if (experiment.status !== "running") {
    experiment = await api(`/environments/${devEnvKey}/experiments/${experiment.id}/start/`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    console.log(`Started experiment: id=${experiment.id}, status=${experiment.status}`);
  }

  return experiment;
}

function writeEnvFiles(devEnvKey, prodEnvKey) {
  const localContent = [
    `NEXT_PUBLIC_FLAGSMITH_ENV_KEY=${devEnvKey}`,
    `NEXT_PUBLIC_FLAGSMITH_PROD_ENV_KEY=${prodEnvKey}`,
    `NEXT_PUBLIC_FLAGSMITH_API_URL=${FLAGSMITH_URL}/api/v1/`,
    `NEXT_PUBLIC_FLAGSMITH_EVENTS_URL=${FLAGSMITH_URL}/api/`,
    "",
  ].join("\n");

  const exampleContent = [
    `NEXT_PUBLIC_FLAGSMITH_ENV_KEY=your_development_environment_key`,
    `NEXT_PUBLIC_FLAGSMITH_PROD_ENV_KEY=your_production_environment_key`,
    `NEXT_PUBLIC_FLAGSMITH_API_URL=http://localhost:8000/api/v1/`,
    `NEXT_PUBLIC_FLAGSMITH_EVENTS_URL=http://localhost:8000/api/`,
    "",
  ].join("\n");

  // Next.js only reads .env.local from the app's own folder, so write it there.
  const appDir = path.join(ROOT_DIR, "apps", "demo-store");
  fs.writeFileSync(path.join(appDir, ".env.local"), localContent, "utf8");
  fs.writeFileSync(path.join(appDir, ".env.example"), exampleContent, "utf8");
  console.log("Wrote apps/demo-store/.env.local and apps/demo-store/.env.example");
}

async function main() {
  const { project, devEnv, prodEnv } = await ensureOrgProjectEnvs();
  const ctaFeature = await ensureMultivariateFeature(project.id);
  await ensureBooleanFeature(project.id, devEnv.api_key, prodEnv.api_key);
  const metric = await ensureExperimentMetric(devEnv.api_key);
  const experiment = await ensureAndStartExperiment(devEnv.api_key, ctaFeature, metric);
  writeEnvFiles(devEnv.api_key, prodEnv.api_key);

  console.log("\nSeed complete:");
  console.log(JSON.stringify({
    projectId: project.id,
    devEnvKey: devEnv.api_key,
    prodEnvKey: prodEnv.api_key,
    experimentId: experiment.id,
    experimentStatus: experiment.status,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
