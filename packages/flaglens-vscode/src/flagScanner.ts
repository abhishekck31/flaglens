// Finds flag names in source text. No `vscode` import, so it's unit-testable
// and can later be reused for pushing code references to Flagsmith.

export interface FlagReference {
  name: string;
  /** 0-based line number (VS Code's convention). */
  line: number;
  /** 0-based column of the opening quote. */
  column: number;
}

/**
 * A quoted string on one line: "...", '...' or `...`, with no quotes or backslashes inside.
 * Flag names never contain those characters, so this simple pattern is enough.
 */
const QUOTED_STRING = /(["'`])([^"'`\\\r\n]+)\1/g;

/**
 * Returns every quoted string that exactly equals a known flag name.
 * Matching against the real flag list (rather than guessing SDK call shapes) means
 * `getValue("x")`, `useFlags(["x"])` and `const FLAG = "x"` are all found.
 */
export function findFlagReferences(text: string, flagNames: ReadonlySet<string>): FlagReference[] {
  const references: FlagReference[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((lineText, line) => {
    for (const match of lineText.matchAll(QUOTED_STRING)) {
      const name = match[2];
      if (name !== undefined && flagNames.has(name)) {
        references.push({ name, line, column: match.index });
      }
    }
  });
  return references;
}

/** A flag key passed to an SDK call, e.g. the `x` in `getValue("x")`. */
export interface FlagCall {
  name: string;
  line: number;
  /** 0-based column of the key's first character (inside the quotes). */
  column: number;
}

/** Functions whose first argument is a flag key. Mirrors the `flaglens.callPatterns` default. */
export const DEFAULT_CALL_PATTERNS = [
  "hasFeature",
  "isFeatureEnabled",
  "getValue",
  "getFeatureValue",
  "getFlag",
  "useFlags",
];

/** A string literal at the very start of `text`. */
const LEADING_STRING = /^(["'`])([^"'`\\\r\n]+)\1/;

/**
 * Finds flag keys passed to known SDK functions, whether or not the flag exists.
 * This is what catches typos: `getValue("checkout_cta_varient")` is found here even though
 * no flag has that name. Handles a string first argument and an array of strings
 * (`useFlags(["a", "b"])`). Only looks within one line, so calls split across lines are skipped.
 */
export function findFlagCalls(text: string, functionNames: readonly string[]): FlagCall[] {
  if (functionNames.length === 0) return [];
  const escaped = functionNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // `\b` + name + "(" : matches `getValue(` and `flagsmith.getValue (` but not `getValues(`.
  const callStart = new RegExp(`\\b(?:${escaped.join("|")})\\s*\\(\\s*`, "g");

  const calls: FlagCall[] = [];
  text.split(/\r?\n/).forEach((lineText, line) => {
    for (const match of lineText.matchAll(callStart)) {
      const argStart = match.index + match[0].length;
      const rest = lineText.slice(argStart);

      if (rest.startsWith("[")) {
        // Array argument: take every string up to the closing bracket.
        const close = rest.indexOf("]");
        const inside = close === -1 ? rest.slice(1) : rest.slice(1, close);
        for (const item of inside.matchAll(QUOTED_STRING)) {
          if (item[2] !== undefined) calls.push({ name: item[2], line, column: argStart + 1 + item.index + 1 });
        }
      } else {
        const single = LEADING_STRING.exec(rest);
        if (single?.[2] !== undefined) calls.push({ name: single[2], line, column: argStart + 1 });
      }
    }
  });
  return calls;
}
