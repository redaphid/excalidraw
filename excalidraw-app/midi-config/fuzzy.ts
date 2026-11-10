/**
 * A small fuzzy matcher for the config page: every word of the query has to
 * appear in the text with its letters in order. Letters may skip ahead
 * within a word ("bg" finds background), but moving on to another word has
 * to land on its first letter ("bgl" finds background lightness, "sw"
 * stroke width), so a long description can't match by scattering letters.
 * Letters that follow one another, and letters that start a word, score
 * higher. Null when it doesn't match at all.
 */

const isAlphanumeric = (char: string | undefined) =>
  !!char && /[a-z0-9]/i.test(char);

const isWordStart = (text: string, index: number) => {
  const current = text[index];
  const previous = text[index - 1];
  if (!isAlphanumeric(current)) {
    return false;
  }
  return (
    !isAlphanumeric(previous) ||
    (current >= "A" && current <= "Z" && previous >= "a" && previous <= "z")
  );
};

/** where the word holding `index` ends (exclusive) */
const wordEnd = (text: string, index: number) => {
  let end = index + 1;
  while (
    end < text.length &&
    isAlphanumeric(text[end]) &&
    !isWordStart(text, end)
  ) {
    end++;
  }
  return end;
};

/** the score of one word matched from a start, or null */
const matchFrom = (
  word: string,
  text: string,
  lower: string,
  start: number,
) => {
  let score = 0;
  let index = start;
  for (let i = 0; i < word.length; i++) {
    if (i > 0) {
      const letter = word[i];
      const previous = index;
      // the rest of the current word first, then the next word to start
      // with this letter
      const end = wordEnd(text, previous);
      let next = lower.indexOf(letter, previous + 1);
      if (next === -1) {
        return null;
      }
      if (next >= end) {
        next = -1;
        for (let j = end; j < text.length; j++) {
          if (lower[j] === letter && isWordStart(text, j)) {
            next = j;
            break;
          }
        }
        if (next === -1) {
          return null;
        }
      }
      index = next;
      if (index === previous + 1) {
        score += 5;
      }
    }
    score += 1;
    if (isWordStart(text, index)) {
      score += 8;
    }
  }
  // an earlier match reads as a better one
  return score - start * 0.05;
};

/** the best score one word gets against the text, or null */
const scoreWord = (word: string, text: string): number | null => {
  const lower = text.toLowerCase();
  let best: number | null = null;
  for (
    let start = lower.indexOf(word[0]);
    start !== -1;
    start = lower.indexOf(word[0], start + 1)
  ) {
    const score = matchFrom(word, text, lower, start);
    if (score !== null) {
      best = best === null ? score : Math.max(best, score);
    }
  }
  return best;
};

export const fuzzyScore = (query: string, text: string): number | null => {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return 0;
  }
  let total = 0;
  for (const word of words) {
    const score = scoreWord(word, text);
    if (score === null) {
      return null;
    }
    total += score;
  }
  return total;
};

/** the items that match, best first; all of them, in order, for no query */
export const fuzzyFilter = <T>(
  query: string,
  items: readonly T[],
  text: (item: T) => string,
): T[] =>
  items
    .map((item, index) => ({
      item,
      index,
      score: fuzzyScore(query, text(item)),
    }))
    .filter((entry) => entry.score !== null)
    .sort((a, b) => b.score! - a.score! || a.index - b.index)
    .map((entry) => entry.item);
