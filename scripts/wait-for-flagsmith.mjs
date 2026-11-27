// Waits until self-hosted Flagsmith answers its liveness check (used by `npm run up`).
// Sets process.exitCode instead of calling process.exit(): exiting while fetch's
// connection is still closing crashes Node on Windows ("Assertion failed ... UV_HANDLE_CLOSING").

const url = "http://localhost:8000/health/liveness/";
const attempts = 90; // 90 x 2 s = 3 minutes (first start runs database migrations)

async function isLive() {
  try {
    const res = await fetch(url);
    await res.arrayBuffer(); // read the body so the connection is released cleanly
    return res.ok;
  } catch {
    return false; // not listening yet
  }
}

for (let i = 0; i < attempts; i++) {
  if (await isLive()) {
    console.log("Flagsmith ready at http://localhost:8000");
    process.exitCode = 0;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
if (process.exitCode !== 0) {
  console.error("Timed out waiting for Flagsmith. Check `docker compose logs flagsmith`.");
  process.exitCode = 1;
}
