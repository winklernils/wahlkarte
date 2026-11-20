import { color as d3color, interpolateLab } from "d3";
import type { Grid } from "../data";

/** Shared look of the 5 km raster in "Stimmen 2D" and "Stimmen 3D". */
export const RAMP_STEPS = 48;
const rampCache = new Map<string, { lit: string[]; shade: string[]; mid: string[] }>();
/** Colour ramp for one party colour: near-white → party colour → dark party colour. */
export function ramp(c: string) {
  if (!rampCache.has(c)) {
    const dark = d3color(c)!.darker(1.4).formatHex();
    const lit: string[] = [], shade: string[] = [], mid: string[] = [];
    for (let k = 0; k < RAMP_STEPS; k++) {
      const t = k / (RAMP_STEPS - 1);
      const base = t < 0.55 ? interpolateLab("#eef0f6", c)(t / 0.55) : interpolateLab(c, dark)((t - 0.55) / 0.45);
      mid.push(d3color(base)!.formatHex());
      lit.push(d3color(base)!.brighter(0.45).formatHex());
      shade.push(d3color(base)!.darker(0.55).formatHex());
    }
    rampCache.set(c, { lit, shade, mid });
  }
  return rampCache.get(c)!;
}
export const rampIndex = (frac: number) => Math.round(Math.pow(Math.min(1, Math.max(0, frac)), 0.65) * (RAMP_STEPS - 1));

/** Large cities, labelled on the fine grid like the reference maps (positions: city centres). */
export const CITIES: [string, number, number, "l" | "r"][] = [
  ["Berlin", 13.405, 52.52, "r"], ["Hamburg", 9.993, 53.551, "r"], ["München", 11.576, 48.137, "r"],
  ["Köln", 6.958, 50.938, "l"], ["Frankfurt", 8.682, 50.111, "r"], ["Stuttgart", 9.183, 48.776, "l"],
  ["Leipzig", 12.374, 51.34, "r"], ["Dresden", 13.738, 51.05, "r"], ["Hannover", 9.732, 52.375, "r"],
  ["Bremen", 8.807, 53.075, "l"], ["Nürnberg", 11.077, 49.452, "r"], ["Ruhrgebiet", 7.2, 51.48, "l"],
];
/** Largest raster cell value: for one party, or across all selectable parties (shared scale). */
const gridMaxCache = new Map<string, number>();
export function gridMax(grid: Grid, vote: "e" | "z", party: string | null): number {
  const key = `${vote}|${party ?? "*"}`;
  if (!gridMaxCache.has(key)) {
    const parties = party ? [party] : ["UNION", "AfD", "SPD", "GRÜNE", "Die Linke", "BSW", "SSW"];
    let m = 0;
    for (const p of parties) {
      const arr = p === "UNION" ? null : grid[vote][p];
      for (let i = 0; i < grid.lon.length; i++) {
        const v = arr ? arr[i] : grid[vote]["CDU"][i] + grid[vote]["CSU"][i];
        if (v > m) m = v;
      }
    }
    gridMaxCache.set(key, m);
  }
  return gridMaxCache.get(key)!;
}

