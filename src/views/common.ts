import { select, type Selection } from "d3";
import type { AreaResult, Data } from "../data";
import { winner } from "../data";
import { marginColor, partyColor } from "../parties";
import type { State } from "../state";

export type Area = { kind: "wk"; id: number } | { kind: "land"; id: string } | { kind: "gem"; id: string };

export interface ViewCtx {
  data: Data;
  state: State;
  /** Called when the pointer/keyboard selects an area (null = back to the national result). */
  onHover: (a: Area | null) => void;
  onPick: (a: Area) => void;
  selected: Area | null;
}
export interface ViewHandle {
  update(ctx: ViewCtx): void;
  destroy(): void;
}

export const W = 760;
export const H = 1000;

export function svgIn(el: HTMLElement, label: string) {
  el.replaceChildren();
  return select(el)
    .append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("role", "img")
    .attr("aria-label", label)
    .attr("class", "map-svg");
}

export function areaOf(data: Data, a: Area): AreaResult {
  if (a.kind === "gem") return data.gem!.byId.get(a.id)!;
  return a.kind === "wk" ? data.wkById.get(a.id)! : data.landById.get(a.id)!;
}
export const landOf = (data: Data, a: Area) =>
  a.kind === "wk" ? data.wkById.get(a.id)!.land : a.kind === "gem" ? data.gem!.byId.get(a.id)!.land : a.id;

/** Fill colour for the winner maps (geo, hex, circles). */
export function winnerFill(data: Data, a: Area, s: State): string {
  const w = winner(areaOf(data, a), s.vote);
  const land = landOf(data, a);
  return s.shading ? marginColor(w.party, w.margin, land) : partyColor(w.party, land);
}

export const sameArea = (a: Area | null, b: Area | null) => !!a && !!b && a.kind === b.kind && a.id === b.id;

/** Wire pointer + keyboard interaction for a selection of area shapes. */
export function interactive<E extends SVGElement, D>(
  sel: Selection<E, D, SVGGElement, unknown>,
  areaFor: (d: D) => Area,
  ctx: () => ViewCtx,
) {
  sel
    .attr("tabindex", -1)
    .classed("area", true)
    .classed("selected", (d) => sameArea(areaFor(d), ctx().selected))
    .on("pointerenter", (_, d) => ctx().onHover(areaFor(d)))
    .on("pointerleave", () => ctx().onHover(null))
    .on("click", (_, d) => ctx().onPick(areaFor(d)));
}

/** Linear fit of layout coordinates (km, y north) into the SVG box. */
export function fitLayout(points: { x: number; y: number; r?: number }[], pad = 30) {
  const minX = Math.min(...points.map((p) => p.x - (p.r ?? 0)));
  const maxX = Math.max(...points.map((p) => p.x + (p.r ?? 0)));
  const minY = Math.min(...points.map((p) => p.y - (p.r ?? 0)));
  const maxY = Math.max(...points.map((p) => p.y + (p.r ?? 0)));
  const k = Math.min((W - 2 * pad) / (maxX - minX), (H - 2 * pad) / (maxY - minY));
  const ox = (W - k * (maxX - minX)) / 2;
  const oy = (H - k * (maxY - minY)) / 2;
  return { k, x: (x: number) => ox + (x - minX) * k, y: (y: number) => H - oy - (y - minY) * k };
}
