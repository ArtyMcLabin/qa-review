// Semantic codenames: a deterministic two-word "adjective-noun" reference for
// every (target, itemId) pair, so humans and agents can talk about an item
// ("I'm QA-ing red-apple") without quoting selectors or ids. Pure + shared by
// the client (card display / copy-ref) and the server (state GET responses).

/** 64 adjectives x 64 nouns = 4096 codenames (collisions possible; the
 * resolver returns ALL matches so callers can disambiguate). */
const ADJECTIVES = [
  "amber", "bold", "brave", "brisk", "calm", "candid", "clear", "cobalt",
  "coral", "cosmic", "crimson", "crisp", "daring", "deep", "dusty", "eager",
  "early", "easy", "fabled", "fancy", "fleet", "frosty", "gentle", "gilded",
  "glad", "golden", "grand", "green", "happy", "hardy", "hazel", "humble",
  "icy", "ivory", "jade", "jolly", "keen", "kind", "large", "lively",
  "lucky", "lunar", "mellow", "merry", "mighty", "misty", "noble", "olive",
  "opal", "pale", "plucky", "proud", "quick", "quiet", "rapid", "red",
  "royal", "ruby", "rustic", "silent", "silver", "snowy", "solar", "swift",
] as const;

const NOUNS = [
  "acorn", "anchor", "apple", "arrow", "badger", "banjo", "beacon", "bear",
  "birch", "bison", "breeze", "brook", "candle", "canyon", "castle", "cloud",
  "comet", "compass", "crane", "creek", "crow", "delta", "dune", "eagle",
  "falcon", "fern", "finch", "fjord", "flint", "forest", "fox", "garnet",
  "glacier", "grove", "harbor", "hawk", "heron", "hill", "iris", "island",
  "jasper", "kite", "lagoon", "lantern", "larch", "lark", "lily", "lynx",
  "maple", "meadow", "meteor", "moon", "moss", "oak", "orbit", "otter",
  "owl", "pebble", "pine", "planet", "prairie", "quartz", "raven", "river",
] as const;

/** FNV-1a 32-bit (deterministic across platforms/sessions). */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Stable two-word codename for a (target, itemId) pair, e.g. "red-apple". */
export function codenameFor(target: string, itemId: string): string {
  const h = fnv1a(`${target}#${itemId}`);
  const adj = ADJECTIVES[(h >>> 6) % ADJECTIVES.length];
  const noun = NOUNS[h % NOUNS.length];
  return `${adj}-${noun}`;
}

export interface CodenameEntry {
  target: string;
  itemId: string;
}

/**
 * Resolve a spoken/written codename ("red-apple", "red apple", "Red Apple")
 * back to items. Returns ALL matches (codename space is 4096; collisions are
 * possible across many items).
 */
export function findByCodename<T extends CodenameEntry>(
  codename: string,
  entries: readonly T[],
): T[] {
  const norm = codename.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return entries.filter((e) => codenameFor(e.target, e.itemId) === norm);
}

/** Canonical copy-reference line for an item ("Copy ref" button payload). */
export function formatQARef(target: string, itemId: string, title: string): string {
  return `qa-ref: ${codenameFor(target, itemId)} | ${target} # ${itemId} | ${title}`;
}
