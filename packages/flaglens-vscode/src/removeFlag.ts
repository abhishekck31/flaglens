// "Remove flag (keep enabled path)": rewrites code for a flag that is ON everywhere.
// Pure logic on top of the TypeScript compiler API, no `vscode` import.
//
// Only three shapes are rewritten; everything else is left alone and reported for manual cleanup:
//   1. if (hasFeature("x")) {A} else {B}     ->  A          (the else branch is optional)
//   2. hasFeature("x") ? A : B               ->  A
//   3. const v = getValue("x"); ...v...      ->  ...<literal>...   (only when the flag's value is
//                                                the same string/number/boolean everywhere)
// `hasFeature` / `getValue` may be called directly or as a method (`flagsmith.hasFeature(...)`).

import ts from "typescript";
import { findFlagReferences } from "./flagScanner.ts";

export type FlagLiteral = string | number | boolean;

export interface ManualCleanup {
  /** 0-based position of the flag name's opening quote, in the REWRITTEN text. */
  line: number;
  column: number;
  reason: string;
}

export interface RemovalResult {
  /** The file after every recognised shape was rewritten (unchanged if none were found). */
  text: string;
  rewrites: number;
  /** Mentions of the flag that are still in `text` and need a human. */
  manual: ManualCleanup[];
}

/** A replacement of text[start, end) with `text`. */
interface Edit {
  start: number;
  end: number;
  text: string;
}

const SCRIPT_KINDS: Record<string, ts.ScriptKind> = {
  ".ts": ts.ScriptKind.TS, ".mts": ts.ScriptKind.TS, ".cts": ts.ScriptKind.TS,
  ".tsx": ts.ScriptKind.TSX,
  ".js": ts.ScriptKind.JS, ".mjs": ts.ScriptKind.JS, ".cjs": ts.ScriptKind.JS,
  ".jsx": ts.ScriptKind.JSX,
};

/** True for the file types this refactoring understands. */
export function isSupportedFile(fileName: string): boolean {
  return extensionOf(fileName) in SCRIPT_KINDS;
}

function extensionOf(fileName: string): string {
  const match = /\.[^./\\]+$/.exec(fileName);
  return match ? match[0].toLowerCase() : "";
}

/**
 * Rewrites every recognised shape for `flagName`. `value` is the flag's value if it's the same
 * literal in every environment; without it, `getValue` declarations are left for manual cleanup.
 */
export function removeFlag(fileName: string, source: string, flagName: string, value?: FlagLiteral): RemovalResult {
  const kind = SCRIPT_KINDS[extensionOf(fileName)];
  if (kind === undefined) throw new Error(`Not a TS/JS file: ${fileName}`);

  let text = source;
  let rewrites = 0;
  // One rewrite per pass, then re-parse: nested checks (an `if` inside the kept branch of
  // another) are handled one at a time, so edits never overlap. Each pass removes one call,
  // so this always ends; the limit is only a safety net.
  for (let pass = 0; pass < 1000; pass++) {
    const sf = parse(fileName, text, kind);
    const edits = findRewrite(sf, flagName, value);
    if (!edits) break;
    text = applyEdits(text, edits);
    rewrites++;
  }

  return { text, rewrites, manual: findManual(parse(fileName, text, kind), flagName, value) };
}

function parse(fileName: string, text: string, kind: ts.ScriptKind): ts.SourceFile {
  // setParentNodes = true: we walk up from calls to their `if` / `?:` / `const`.
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
}

/** `hasFeature("x")` or `something.hasFeature("x")` with a plain string literal first argument. */
function isFlagCall(node: ts.Node, fn: string, flagName: string): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  return calleeName(node) === fn && literalArg(node) === flagName;
}

function calleeName(call: ts.CallExpression): string | undefined {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
}

function literalArg(call: ts.CallExpression): string | undefined {
  const arg = call.arguments[0];
  return arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) ? arg.text : undefined;
}

/** The edits for the FIRST recognised shape in source order, or undefined if there is none. */
function findRewrite(sf: ts.SourceFile, flagName: string, value: FlagLiteral | undefined): Edit[] | undefined {
  let found: Edit[] | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (isFlagCall(node, "hasFeature", flagName)) {
      const parent = node.parent;
      if (ts.isIfStatement(parent) && parent.expression === node) found = rewriteIf(sf, parent);
      else if (ts.isConditionalExpression(parent) && parent.condition === node) found = rewriteConditional(sf, parent);
    } else if (value !== undefined && isFlagCall(node, "getValue", flagName)) {
      found = rewriteConst(sf, node, value);
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

// ---- Shape 1: if (hasFeature("x")) {A} else {B}  ->  A ----

function rewriteIf(sf: ts.SourceFile, stmt: ts.IfStatement): Edit[] {
  const text = sf.text;
  const start = stmt.getStart(sf);
  const end = stmt.getEnd();
  const then = stmt.thenStatement;
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const indent = text.slice(lineStart, start);

  // Unwrap the braces only when that is safe and readable: the `if` is a statement of its own
  // (not `else if`), starts its line, and the block declares no let/const/class/function that
  // could clash with names around it. Otherwise keep the block (or single statement) as is.
  const canUnwrap =
    ts.isBlock(then) &&
    isInStatementList(stmt) &&
    /^[ \t]*$/.test(indent) &&
    !then.statements.some(declaresBlockScopedName);

  if (!canUnwrap) return [{ start, end, text: then.getText(sf) }];

  const body = dedent(text.slice(then.getStart(sf) + 1, then.getEnd() - 1), indent, eolOf(text));
  if (body === "") return [removeLines(text, start, end)]; // empty {A}: drop the whole `if`
  return [{ start, end, text: body }];
}

function isInStatementList(node: ts.Node): boolean {
  const p = node.parent;
  return ts.isBlock(p) || ts.isSourceFile(p) || ts.isModuleBlock(p) || ts.isCaseClause(p) || ts.isDefaultClause(p);
}

function declaresBlockScopedName(stmt: ts.Statement): boolean {
  if (ts.isVariableStatement(stmt)) return (stmt.declarationList.flags & ts.NodeFlags.BlockScoped) !== 0;
  return ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt);
}

/**
 * Turns the inside of `{ ... }` into statements at `indent`: drops the blank first/last lines
 * and removes one level of indentation. The first line gets no indent because the replacement
 * starts where `if` started, after the existing indentation.
 */
function dedent(inner: string, indent: string, eol: string): string {
  const lines = inner.split("\n").map((l) => l.replace(/\r$/, ""));
  while (lines.length > 0 && lines[0]!.trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
  if (lines.length === 0) return "";
  const widths = lines.filter((l) => l.trim() !== "").map((l) => /^[ \t]*/.exec(l)![0].length);
  const min = Math.min(...widths);
  return lines
    .map((l, i) => (l.trim() === "" ? "" : (i === 0 ? "" : indent) + l.slice(min).trimEnd()))
    .join(eol);
}

// ---- Shape 2: hasFeature("x") ? A : B  ->  A ----

function rewriteConditional(sf: ts.SourceFile, cond: ts.ConditionalExpression): Edit[] {
  const kept = cond.whenTrue;
  let replacement = kept.getText(sf);
  // `{...}`, `function(){}` and `class{}` would be read as a block / declaration at the start
  // of a statement or arrow-function body, so wrap them in parentheses to keep them expressions.
  if (ts.isObjectLiteralExpression(kept) || ts.isFunctionExpression(kept) || ts.isClassExpression(kept)) {
    replacement = `(${replacement})`;
  }
  return [{ start: cond.getStart(sf), end: cond.getEnd(), text: replacement }];
}

// ---- Shape 3: const v = getValue("x")  ->  inline the literal ----

function rewriteConst(sf: ts.SourceFile, call: ts.CallExpression, value: FlagLiteral): Edit[] | undefined {
  const decl = call.parent;
  if (!ts.isVariableDeclaration(decl) || decl.initializer !== call || !ts.isIdentifier(decl.name)) return undefined;
  const list = decl.parent;
  if (!ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0) return undefined;
  if (list.declarations.length !== 1) return undefined; // `const a = ..., b = ...`: leave it
  const stmt = list.parent;
  if (!ts.isVariableStatement(stmt)) return undefined; // e.g. `for (const v = ...)`
  // Exported constants are used by other modules we can't see here.
  if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return undefined;

  // The type checker resolves which identifiers are THIS `v` (not a shadowing `v` in an inner
  // scope). A one-file program is enough: no libraries or imports are needed for local names.
  const checker = singleFileChecker(sf);
  const symbol = checker.getSymbolAtLocation(decl.name);
  if (!symbol) return undefined;

  const edits: Edit[] = [removeLines(sf.text, stmt.getStart(sf), stmt.getEnd())];
  let unsafe = false;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node !== decl.name) {
      const parent = node.parent;
      const shorthand = ts.isShorthandPropertyAssignment(parent) && parent.name === node;
      const target = shorthand ? checker.getShorthandAssignmentValueSymbol(parent) : checker.getSymbolAtLocation(node);
      if (target === symbol) {
        if (ts.isExportSpecifier(parent)) unsafe = true; // `export { v }`
        const needsParens = ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent);
        const literal = literalText(value, needsParens);
        edits.push({ start: node.getStart(sf), end: node.getEnd(), text: shorthand ? `${node.text}: ${literal}` : literal });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return unsafe ? undefined : edits;
}

/** Source text for a literal. Negative numbers, and numbers before `.x`, get parentheses (`(-1)`, `(5).toFixed()`). */
function literalText(value: FlagLiteral, beforeMemberAccess: boolean): string {
  if (typeof value === "string") return JSON.stringify(value);
  const text = String(value);
  return typeof value === "number" && (value < 0 || beforeMemberAccess) ? `(${text})` : text;
}

function singleFileChecker(sf: ts.SourceFile): ts.TypeChecker {
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (name === sf.fileName ? sf : undefined),
    fileExists: (name) => name === sf.fileName,
    readFile: () => undefined,
    writeFile: () => {},
    getDefaultLibFileName: () => "lib.d.ts",
    getCurrentDirectory: () => "",
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, allowJs: true, jsx: ts.JsxEmit.Preserve };
  return ts.createProgram([sf.fileName], options, host).getTypeChecker();
}

// ---- Helpers ----

/** Deletes [start, end); if that span is alone on its line(s), deletes the whole lines. */
function removeLines(text: string, start: number, end: number): Edit {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const newline = text.indexOf("\n", end);
  const lineEnd = newline === -1 ? text.length : newline + 1;
  const before = text.slice(lineStart, start);
  const after = text.slice(end, newline === -1 ? text.length : newline);
  if (/^[ \t]*$/.test(before) && /^[ \t]*\r?$/.test(after)) return { start: lineStart, end: lineEnd, text: "" };
  return { start, end, text: "" };
}

function eolOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function applyEdits(text: string, edits: Edit[]): string {
  // Back to front, so earlier offsets stay valid.
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** Why each remaining mention wasn't rewritten. */
function findManual(sf: ts.SourceFile, flagName: string, value: FlagLiteral | undefined): ManualCleanup[] {
  // Map: offset of a call's first argument -> the function name it was passed to.
  const callAt = new Map<number, string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && literalArg(node) === flagName) {
      callAt.set(node.arguments[0]!.getStart(sf), calleeName(node) ?? "(call)");
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return findFlagReferences(sf.text, new Set([flagName])).map((ref) => {
    const fn = callAt.get(sf.getPositionOfLineAndCharacter(ref.line, ref.column));
    let reason: string;
    if (fn === "hasFeature") reason = "hasFeature(...) is not the whole condition of an if or ?:";
    else if (fn === "getValue" && value === undefined) reason = "the flag's value isn't the same string/number/boolean in every environment";
    else if (fn === "getValue") reason = "getValue(...) is not in a plain, non-exported `const v = getValue(...)`";
    else if (fn) reason = `${fn}(...) is not a supported call`;
    else reason = "mentioned outside a hasFeature/getValue call";
    return { line: ref.line, column: ref.column, reason };
  });
}

/** The smallest single replacement that turns `before` into `after` (for a tidy diff/edit). */
export function changedRange(before: string, after: string): Edit {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endB = before.length;
  let endA = after.length;
  while (endB > start && endA > start && before[endB - 1] === after[endA - 1]) {
    endB--;
    endA--;
  }
  return { start, end: endB, text: after.slice(start, endA) };
}
