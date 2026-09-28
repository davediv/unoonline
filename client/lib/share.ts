/**
 * `next`, but reusing every part of `previous` that is deeply equal to it.
 *
 * Every frame from the room is a freshly parsed copy of the whole state, so
 * without this a player, `moves`, or the rules would be a new object each
 * time and every memoized component under the table would re-render even
 * when nothing it shows had changed. Plain JSON data only.
 */
export function share<T>(previous: T, next: T): T {
  if (Object.is(previous, next)) return previous;
  if (typeof previous !== 'object' || typeof next !== 'object' || !previous || !next) return next;

  if (Array.isArray(next)) {
    if (!Array.isArray(previous)) return next;
    let same = previous.length === next.length;
    const out = next.map((item: unknown, index) => {
      const value = share(previous[index], item);
      if (value !== previous[index]) same = false;
      return value;
    });
    return (same ? previous : out) as T;
  }
  if (Array.isArray(previous)) return next;

  const before = previous as Record<string, unknown>;
  const after = next as Record<string, unknown>;
  const keys = Object.keys(after);
  let same = keys.length === Object.keys(before).length;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = share(before[key], after[key]);
    out[key] = value;
    if (value !== before[key] || !(key in before)) same = false;
  }
  return (same ? previous : out) as T;
}
