/**
 * /resume argument resolution. Pure and UI-free so the prefix rules can be
 * unit-tested without booting Ink; index.tsx wires the result to actions.
 */

export type ThreadMatch =
  | { kind: "exact"; id: string }
  | { kind: "unique"; id: string }
  | { kind: "none" }
  | { kind: "ambiguous"; count: number };

/** Resolve a /resume argument against known thread ids: exact id wins, then
 * unique-prefix match; zero or several prefix matches are reported as such. */
export function matchThreadPrefix(ids: string[], arg: string): ThreadMatch {
  if (ids.includes(arg)) return { kind: "exact", id: arg };
  const matches = ids.filter((id) => id.startsWith(arg));
  if (matches.length === 1) return { kind: "unique", id: matches[0] as string };
  if (matches.length === 0) return { kind: "none" };
  return { kind: "ambiguous", count: matches.length };
}