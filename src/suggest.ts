/** Orders candidates by how close they are to `target`: substring matches first, then edit distance. */
export function rankByCloseness(target: string, candidates: Iterable<string>): string[] {
  const t = target.toLowerCase();
  const tail = t.slice(t.indexOf('.') + 1);
  return [...candidates]
    .map((candidate) => {
      const c = candidate.toLowerCase();
      const contains = tail.length > 1 && c.includes(tail) ? 0 : 1;
      return { candidate, contains, distance: levenshtein(t, c) };
    })
    .toSorted((a, b) => a.contains - b.contains || a.distance - b.distance)
    .map(({ candidate }) => candidate);
}

/** The closest candidate if it looks like a typo of `word`, for "did you mean" hints. */
export function closestMatch(word: string, candidates: Iterable<string>): string | undefined {
  // Allow one edit per three characters so short words do not match unrelated ones (foo -> row)
  const limit = Math.max(1, Math.floor(word.length / 3));
  let best: { candidate: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const distance = levenshtein(word.toLowerCase(), candidate.toLowerCase());
    if (distance <= limit && (!best || distance < best.distance)) best = { candidate, distance };
  }
  return best?.candidate;
}

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}
