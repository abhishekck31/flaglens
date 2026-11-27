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
