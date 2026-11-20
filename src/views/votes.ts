import { type AreaResult, type Data, type VoteKey, partyVotes } from "../data";
import { SELECTABLE } from "../parties";
import type { State } from "../state";

const cache = new Map<string, number>();
/** Largest vote count of one area (Wahlkreis or Land): for one party, or across all selectable parties. */
export function voteMax(data: Data, vote: VoteKey, party: string | null, level: State["level"]): number {
  const key = `${vote}|${party ?? "*"}|${level}`;
  if (!cache.has(key)) {
    const parties = party ? [party] : [...SELECTABLE];
    const areas: AreaResult[] = level === "land" ? data.results.laender : data.results.wahlkreise;
    let m = 0;
    for (const a of areas) for (const p of parties) m = Math.max(m, partyVotes(a, p, vote) ?? 0);
    cache.set(key, m);
  }
  return cache.get(key)!;
}
export const scaleMax = (data: Data, s: State) =>
  voteMax(data, s.vote, s.scale === "shared" ? null : s.party, s.level);

/** Rounded legend steps, e.g. 20 000 / 40 000 / 60 000 (or 1 / 2 / 3 million for Länder). */
export function niceSteps(max: number): number[] {
  const step = [5e3, 1e4, 2e4, 25e3, 5e4, 1e5, 2.5e5, 5e5, 1e6, 2e6].find((s) => max / s <= 4) ?? 5e6;
  const out: number[] = [];
  for (let v = step; v <= max; v += step) out.push(v);
  return out.slice(-3);
}
