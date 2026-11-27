// "Did you mean ...?" suggestions for mistyped flag names.

/**
 * Levenshtein distance: the fewest single-character insertions, deletions or
 * substitutions that turn `a` into `b`. Classic dynamic programming, one row at a time.
 */
export function levenshtein(a: string, b: string): number {
  // previous[j] = distance between the first i-1 chars of a and the first j chars of b.
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const deletion = (previous[j] ?? 0) + 1;
      const insertion = (current[j - 1] ?? 0) + 1;
      current.push(Math.min(substitution, deletion, insertion));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/**
 * The known name closest to `name`, or undefined if none is within `maxDistance` edits.
 * Ties go to the alphabetically first name, so the suggestion is stable.
 */
export function closestName(name: string, candidates: Iterable<string>, maxDistance = 3): string | undefined {
  let best: { name: string; distance: number } | undefined;
  for (const candidate of [...candidates].sort()) {
    const distance = levenshtein(name, candidate);
    if (distance <= maxDistance && (!best || distance < best.distance)) {
      best = { name: candidate, distance };
    }
  }
  return best?.name;
}
