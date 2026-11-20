import type { Lang } from "./i18n";
import type { SizeMeasure, VoteKey } from "./data";

export type View = "geo" | "hex" | "circles" | "spikes" | "relief";
export interface State {
  view: View;
  /** "gem" (municipalities) exists only for the geographic map */
  level: "wk" | "land" | "gem";
  vote: VoteKey;
  party: string;
  lang: Lang;
  size: SizeMeasure;
  shading: boolean;
  scale: "shared" | "party";
  relief: "columns" | "areas";
  /** 2D spike map at Wahlkreis level: fine 5 km grid (true) or one spike per Wahlkreis */
  grid: boolean;
  /** vote views and labels: absolute votes or shares of valid votes (%) */
  measure: "abs" | "pct";
}

const DEFAULTS: State = {
  view: "hex",
  level: "wk",
  vote: "z",
  party: "UNION",
  lang: "de",
  size: "eligible",
  shading: true,
  scale: "party",
  relief: "columns",
  grid: true,
  measure: "abs",
};
const ALLOWED: { [K in keyof State]?: readonly string[] } = {
  view: ["geo", "hex", "circles", "spikes", "relief"],
  level: ["wk", "land", "gem"],
  vote: ["e", "z"],
  lang: ["de", "en"],
  size: ["eligible", "valid"],
  scale: ["shared", "party"],
  relief: ["columns", "areas"],
  measure: ["abs", "pct"],
};

function fromHash(): State {
  const p = new URLSearchParams(location.hash.slice(1));
  const s: State = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS) as (keyof State)[]) {
    const v = p.get(k);
    if (v === null) continue;
    if (k === "shading") s.shading = v !== "0";
    else if (k === "grid") s.grid = v !== "0";
    else if (k === "party") s.party = v;
    else if (ALLOWED[k]?.includes(v)) (s as unknown as Record<string, string>)[k] = v;
  }
  return s;
}

let state = fromHash();
const listeners = new Set<(s: State, prev: State) => void>();

export const getState = () => state;
export function setState(patch: Partial<State>) {
  const prev = state;
  state = { ...state, ...patch };
  const p = new URLSearchParams();
  for (const k of Object.keys(DEFAULTS) as (keyof State)[]) {
    if (state[k] !== DEFAULTS[k]) p.set(k, typeof state[k] === "boolean" ? (state[k] ? "1" : "0") : String(state[k]));
  }
  history.replaceState(null, "", p.toString() ? `#${p}` : location.pathname + location.search);
  listeners.forEach((f) => f(state, prev));
}
export const subscribe = (f: (s: State, prev: State) => void) => listeners.add(f);
window.addEventListener("hashchange", () => {
  const prev = state;
  state = fromHash();
  listeners.forEach((f) => f(state, prev));
});
