// HTML for the "Compare environments" webview. Pure (no `vscode` import) so it can be tested.
// All decisions (which cells differ, which rows can be promoted) are made here in TypeScript;
// the tiny script in the page only forwards clicks and dropdown changes to the extension.

import { sameCell, type Cell, type CompareRow } from "./compare.ts";
import type { Environment } from "./flagsmithClient.ts";
import { isProductionName } from "./format.ts";

export interface CompareModel {
  projectName: string;
  environments: readonly Environment[];
  rows: readonly CompareRow[];
  /** Indexes into `environments`. */
  sourceIndex: number;
  targetIndex: number;
}

/** Messages the page sends to the extension. */
export type CompareMessage =
  | { type: "select"; source: number; target: number }
  | { type: "promote"; flags: string[] }
  | { type: "refresh" };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

function cellHtml(cell: Cell | null, highlight: boolean): string {
  if (!cell) return `<td class="missing">–</td>`;
  const state = cell.enabled ? `<span class="on">● on</span>` : `<span class="off">○ off</span>`;
  const value = cell.value === null ? "" : `<div class="value">${escapeHtml(JSON.stringify(cell.value))}</div>`;
  return `<td class="${highlight ? "diff" : ""}">${state}${value}</td>`;
}

/** Flags whose source and target cells differ (what "Promote all differences" would send). */
export function differingFlags(model: CompareModel): string[] {
  return model.rows
    .filter((r) => {
      const s = r.cells[model.sourceIndex] ?? null;
      const t = r.cells[model.targetIndex] ?? null;
      return s !== null && t !== null && !sameCell(s, t);
    })
    .map((r) => r.name);
}

export function renderCompareHtml(model: CompareModel, nonce: string, cspSource: string): string {
  const { environments, sourceIndex, targetIndex } = model;
  const source = environments[sourceIndex];
  const target = environments[targetIndex];
  const differing = new Set(differingFlags(model));
  const targetIsProd = target ? isProductionName(target.name) : false;
  const v2 = target?.use_v2_feature_versioning === true;

  const options = (selected: number) =>
    environments
      .map((e, i) => `<option value="${i}"${i === selected ? " selected" : ""}>${escapeHtml(e.name)}</option>`)
      .join("");

  const header = environments
    .map((e, i) => {
      const role = i === sourceIndex ? " (source)" : i === targetIndex ? " (target)" : "";
      return `<th>${isProductionName(e.name) ? "⚠ " : ""}${escapeHtml(e.name)}${role}</th>`;
    })
    .join("");

  const body = model.rows
    .map((row) => {
      const canPromote = differing.has(row.name) && !v2;
      const cells = row.cells
        .map((c, i) => {
          // Highlight the source/target pair that differs; other columns just get the row tint.
          const pair = (i === sourceIndex || i === targetIndex) && differing.has(row.name);
          return cellHtml(c, pair);
        })
        .join("");
      const button = canPromote
        ? `<button data-flag="${escapeHtml(row.name)}">Promote →</button>`
        : "";
      return `<tr class="${row.differs ? "differs" : ""}"><th scope="row">${escapeHtml(row.name)}</th>${cells}<td>${button}</td></tr>`;
    })
    .join("");

  const promoteAll =
    differing.size > 0 && !v2
      ? `<button id="promote-all">Promote all differences (${differing.size})</button>`
      : `<span class="muted">${v2 ? "Target uses feature versioning (v2): promote is disabled." : "No differences between source and target."}</span>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Compare environments</title>
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; }
  .bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
  tr.differs { background: var(--vscode-diffEditor-insertedLineBackground, rgba(155, 185, 85, 0.1)); }
  td.diff { outline: 2px solid var(--vscode-editorWarning-foreground); outline-offset: -2px; }
  .on { color: var(--vscode-testing-iconPassed); } .off { color: var(--vscode-descriptionForeground); }
  .value { font-family: var(--vscode-editor-font-family); font-size: 0.9em; margin-top: 2px; }
  .muted, .missing { color: var(--vscode-descriptionForeground); }
  .prod { color: var(--vscode-editorWarning-foreground); font-weight: 600; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 10px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); padding: 2px; }
</style>
</head>
<body>
<h2>${escapeHtml(model.projectName)}: compare environments</h2>
<div class="bar">
  <label>From <select id="source">${options(sourceIndex)}</select></label>
  <label>to <select id="target">${options(targetIndex)}</select></label>
  ${targetIsProd ? `<span class="prod">⚠ target is production: you'll be asked to confirm</span>` : ""}
  ${promoteAll}
  <button id="refresh">Refresh</button>
</div>
<p class="muted">Tinted rows differ between any environments; outlined cells differ between ${escapeHtml(source?.name ?? "source")} and ${escapeHtml(target?.name ?? "target")}.
Promote copies on/off and value only (not segment or identity overrides). States are re-read from Flagsmith before anything is written.</p>
<table>
  <thead><tr><th>Flag</th>${header}<th></th></tr></thead>
  <tbody>${body}</tbody>
</table>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const select = () => vscode.postMessage({ type: "select",
    source: Number(document.getElementById("source").value), target: Number(document.getElementById("target").value) });
  document.getElementById("source").addEventListener("change", select);
  document.getElementById("target").addEventListener("change", select);
  document.getElementById("refresh").addEventListener("click", () => vscode.postMessage({ type: "refresh" }));
  const all = document.getElementById("promote-all");
  if (all) all.addEventListener("click", () => vscode.postMessage({ type: "promote", flags: ${JSON.stringify([...differing]).replace(/</g, "\\u003c")} }));
  for (const b of document.querySelectorAll("button[data-flag]")) {
    b.addEventListener("click", () => vscode.postMessage({ type: "promote", flags: [b.dataset.flag] }));
  }
</script>
</body>
</html>`;
}
