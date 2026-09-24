/** Capitalised words that carry no factual claim about the candidate. */
const NEUTRAL = new Set(
  (
    'i my me we our you your dear hello hi team hiring manager sincerely regards thank thanks best ' +
    'the a an and or but in on at to for of with as by from this that these those it its is are was were be ' +
    'in addition additionally also having while when where which who what how why because since after before ' +
    'january february march april may june july august september october november december ' +
    'monday tuesday wednesday thursday friday saturday sunday us u.s ' +
    'senior junior lead principal staff engineer engineering developer software full stack full-stack role position opportunity company'
  ).split(' '),
);

function stripPunct(word: string): string {
  return word.replace(/^[^\p{L}\p{N}#.+$%]+|[^\p{L}\p{N}#+%]+$/gu, '');
}

function looksTechnical(word: string): boolean {
  return /[#+/]|\d|\.[a-z]/i.test(word) || /^[A-Z]{2,}s?$/.test(word);
}

/**
 * Finds terms in generated text that make a factual claim (a technology, a
 * number, a proper noun) not supported by the base resume or the job itself.
 * It over-flags on purpose: the owner reviews the list before approving.
 */
export function findUngroundedTerms(text: string, corpus: string, allowed: string[] = []): string[] {
  const allowText = allowed.join(' ').toLowerCase();
  const flagged = new Map<string, string>();

  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    // "C#/.NET" is two claims; check each part. Contractions ("I've") carry no claim.
    const words = sentence
      .split(/\s+/)
      .flatMap((w) => (w.includes('/') && !/^https?:/i.test(w) ? w.split('/') : [w]))
      .map(stripPunct)
      .filter((w) => w && !/^(i|you|we|they|it|that|there)['’](ve|m|d|ll|re|s)$/i.test(w));
    words.forEach((word, index) => {
      const lower = word.toLowerCase();
      if (NEUTRAL.has(lower) || lower.length < 2) return;
      const isNumber = /^\$?\d[\d,.]*(%|\+|k)?$/i.test(word);
      const isCapitalised = /^\p{Lu}/u.test(word);
      // The first word of a sentence is capitalised anyway; only check it when it looks technical.
      const candidate = isNumber || looksTechnical(word) || (isCapitalised && index > 0);
      if (!candidate) return;
      const bare = lower.replace(/[+%]$/, '');
      if (corpus.includes(bare) || allowText.includes(bare)) return;
      flagged.set(lower, word);
    });
  }
  return [...flagged.values()].slice(0, 40);
}
