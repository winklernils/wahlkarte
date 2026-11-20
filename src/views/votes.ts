import { type AreaResult, type Data, type VoteKey, partyVotes } from "../data";
import { fmt, pct } from "../i18n";
import { SELECTABLE } from "../parties";
import type { State } from "../state";

export type Measure = State["measure"];

/** Value of a party in an area: absolute votes, or share of valid votes in % ("pct"). null = not on the ballot. */
export function measureOf(a: AreaResult, party: string, vote: VoteKey, measure: Measure): number | null {
  const v = partyVotes(a, party, vote);
  if (v === null || measure === "abs") return v;
  const valid = a.valid[vote === "e" ? 0 : 1];
  return valid > 0 ? (100 * v) / valid : 0;
}

const cache = new Map<string, number>();
/** Largest value of one area (Wahlkreis or Land): for one party, or across all selectable parties. */
export function voteMax(data: Data, vote: VoteKey, party: string | null, level: State["level"], measure: Measure): number {
  const key = `${vote}|${party ?? "*"}|${level}|${measure}`;
  if (!cache.has(key)) {
    const parties = party ? [party] : [...SELECTABLE];
    const areas: AreaResult[] = level === "land" ? data.results.laender : data.results.wahlkreise;
    let m = 0;
    for (const a of areas) for (const p of parties) m = Math.max(m, measureOf(a, p, vote, measure) ?? 0);
    cache.set(key, m);
  }
  return cache.get(key)!;
}
export const scaleMax = (data: Data, s: State) =>
  voteMax(data, s.vote, s.scale === "shared" ? null : s.party, s.level, s.measure);

/** Rounded legend steps: e.g. 20 000 / 40 000 / 60 000 votes, or 10 / 20 / 30 %. */
export function niceSteps(max: number, measure: Measure = "abs"): number[] {
  const steps = measure === "pct" ? [1, 2, 5, 10, 20, 25] : [5e3, 1e4, 2e4, 25e3, 5e4, 1e5, 2.5e5, 5e5, 1e6, 2e6];
  const step = steps.find((s) => max / s <= 4) ?? (measure === "pct" ? 50 : 5e6);
  const out: number[] = [];
  for (let v = step; v <= max + 1e-9; v += step) out.push(v);
  return out.slice(-3);
}

/** Legend / label text for a value. */
export const fmtMeasure = (v: number, measure: Measure) => (measure === "pct" ? pct(v, 0) : fmt(v));
