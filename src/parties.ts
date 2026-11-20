import { color as d3color, interpolateLab } from "d3";

/** Parties offered in the party selector. CDU and CSU are one choice ("UNION"). */
export const SELECTABLE = ["UNION", "AfD", "SPD", "GRÜNE", "Die Linke", "BSW", "SSW"] as const;
export type Selectable = (typeof SELECTABLE)[number];

/** Parties that won seats in the 21st Bundestag (BSW missed the 5 % threshold with 4.98 %). */
export const IN_BUNDESTAG = new Set(["UNION", "CDU", "CSU", "AfD", "SPD", "GRÜNE", "Die Linke", "SSW"]);

const LIGHT: Record<string, string> = {
  CDU: "#262626",
  CSU: "#3d5a73",
  AfD: "#0aa0de",
  SPD: "#e3000f",
  "GRÜNE": "#3f9b2d",
  "Die Linke": "#be3075",
  BSW: "#7d254f",
  SSW: "#00337d",
  FDP: "#e5c600",
  "FREIE WÄHLER": "#f29200",
};
const DARK: Record<string, string> = {
  ...LIGHT,
  CDU: "#6e6e6e", // pure black disappears on a dark background
  CSU: "#6f8fae",
  SSW: "#4f7fd0",
  BSW: "#b04a7c",
};
const OTHER = "#9a9a9a";

/** Light mode is the default; dark mode only when the visitor switches it on. */
export const isDark = () => document.documentElement.dataset.theme === "dark";

export function partyColor(party: string, land?: string): string {
  const pal = isDark() ? DARK : LIGHT;
  if (party === "UNION") return pal[land === "BY" ? "CSU" : "CDU"];
  return pal[party] ?? OTHER;
}

/** Party colour toned towards the background for close races (NYT-style margin shading). */
export function marginColor(party: string, margin: number, land?: string): string {
  const dark = isDark();
  const bg = dark ? "#1b1b1b" : "#ffffff";
  const lo = dark ? 0.45 : 0.3; // keep close races visible against a dark background
  const t = lo + (1 - lo) * Math.min(1, margin / 25);
  return d3color(interpolateLab(bg, partyColor(party, land))(t))!.formatHex();
}

export function partyLabel(p: string): string {
  if (p === "UNION") return "CDU/CSU";
  if (p.startsWith("EB: ")) return p.slice(4);
  return p;
}
