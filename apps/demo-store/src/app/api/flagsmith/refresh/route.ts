import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

function readMasterKey(): string | undefined {
  if (process.env.FLAGSMITH_API_KEY_localhost_8000) {
    return process.env.FLAGSMITH_API_KEY_localhost_8000;
  }
  const candidates = [
    path.join(process.cwd(), "flagsmith.env"),
    path.join(process.cwd(), "..", "..", "flagsmith.env"),
  ];
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith("FLAGSMITH_API_KEY_localhost_8000=")) {
        return trimmed.slice("FLAGSMITH_API_KEY_localhost_8000=".length).trim();
      }
    }
  }
  return undefined;
}

export async function POST() {
  const masterKey = readMasterKey();
  const envKey = process.env.NEXT_PUBLIC_FLAGSMITH_ENV_KEY;
  const apiBase = (process.env.NEXT_PUBLIC_FLAGSMITH_API_URL || "http://localhost:8000/api/v1/").replace(/\/+$/, "");

  if (!masterKey || !envKey) {
    return NextResponse.json(
      { detail: "Missing master API key or environment key." },
      { status: 500 }
    );
  }

  const targetUrl = `${apiBase}/environments/${envKey}/experiments/1/results/refresh/`;
  const res = await fetch(targetUrl, {
    method: "POST",
    headers: {
      Authorization: `Api-Key ${masterKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const text = await res.text();
  return new NextResponse(text || "{}", {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
