import { t } from "../i18n";
import { type ViewCtx, type ViewHandle, fitLayout, interactive, svgIn, winnerFill } from "./common";

/** Hexagon cartogram: one equal-size hexagon per Wahlkreis (Wahlkreise have near-equal population). */
export function hexView(el: HTMLElement, ctx0: ViewCtx): ViewHandle {
  let ctx = ctx0;
  const draw = () => {
    const { data, state } = ctx;
    const cells = data.hex.cells;
    const fit = fitLayout(cells.map((c) => ({ ...c, r: data.hex.side })));
    const r = data.hex.side * fit.k;
    const corners = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 180) * (60 * i - 90); // pointy-top
      return [r * Math.cos(a), r * Math.sin(a)];
    });
    const hexPath = (cx: number, cy: number) =>
      "M" + corners.map(([x, y]) => `${(cx + x).toFixed(2)},${(cy + y).toFixed(2)}`).join("L") + "Z";

    const svg = svgIn(el, t("view.hex"));
    const isLand = state.level === "land";
    interactive(
      svg.append("g")
        .selectAll<SVGPathElement, (typeof cells)[number]>("path")
        .data(cells)
        .join("path")
        .attr("d", (c) => hexPath(fit.x(c.x), fit.y(c.y)))
        .attr("class", "hex")
        .attr("fill", (c) =>
          winnerFill(data, isLand ? { kind: "land", id: c.land } : { kind: "wk", id: c.id }, state),
        ),
      (c) => (isLand ? { kind: "land", id: c.land } : { kind: "wk", id: c.id }),
      () => ctx,
    );

    // Land borders: hexagon edges whose two sides belong to different Länder (or the outside)
    const edges = new Map<string, { lands: string[]; seg: string }>();
    for (const c of cells) {
      const cx = fit.x(c.x), cy = fit.y(c.y);
      for (let i = 0; i < 6; i++) {
        const [x1, y1] = corners[i], [x2, y2] = corners[(i + 1) % 6];
        const key = `${Math.round(cx + (x1 + x2) / 2)},${Math.round(cy + (y1 + y2) / 2)}`;
        const e = edges.get(key) ?? { lands: [], seg: `M${cx + x1},${cy + y1}L${cx + x2},${cy + y2}` };
        e.lands.push(c.land);
        edges.set(key, e);
      }
    }
    const border = [...edges.values()].filter((e) => e.lands.length === 1 || e.lands[0] !== e.lands[1]);
    svg.append("path").attr("class", isLand ? "hex-land-border strong" : "hex-land-border")
      .attr("d", border.map((e) => e.seg).join(""));

    // Land labels at the mean position of each Land's hexagons
    const byLand = new Map<string, { x: number; y: number; n: number }>();
    for (const c of cells) {
      const m = byLand.get(c.land) ?? { x: 0, y: 0, n: 0 };
      m.x += fit.x(c.x); m.y += fit.y(c.y); m.n++;
      byLand.set(c.land, m);
    }
    svg.append("g").attr("class", "labels")
      .selectAll("text")
      .data([...byLand])
      .join("text")
      .attr("x", ([, m]) => m.x / m.n)
      .attr("y", ([, m]) => m.y / m.n)
      .attr("dy", "0.35em")
      .text(([l]) => l);
  };
  draw();
  return { update: (c) => ((ctx = c), draw()), destroy: () => el.replaceChildren() };
}
