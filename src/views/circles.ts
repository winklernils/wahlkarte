import { t } from "../i18n";
import { type Area, type ViewCtx, type ViewHandle, fitLayout, interactive, svgIn, winnerFill } from "./common";

/** Dorling cartogram: circle area proportional to eligible voters (or valid votes). */
export function circlesView(el: HTMLElement, ctx0: ViewCtx): ViewHandle {
  let ctx = ctx0;
  const draw = () => {
    const { data, state } = ctx;
    const isLand = state.level === "land";
    const items: { id: number | string; x: number; y: number; r: number }[] = isLand
      ? data.circles.land[state.size].items
      : data.circles.wahlkreis[state.size].items;
    const fit = fitLayout(items, 40);
    const areaFor = (d: { id: number | string }): Area =>
      isLand ? { kind: "land", id: d.id as string } : { kind: "wk", id: d.id as number };

    const svg = svgIn(el, t("view.circles"));
    interactive(
      svg.append("g")
        .selectAll<SVGCircleElement, (typeof items)[number]>("circle")
        .data(items)
        .join("circle")
        .attr("cx", (d) => fit.x(d.x))
        .attr("cy", (d) => fit.y(d.y))
        .attr("r", (d) => d.r * fit.k)
        .attr("class", "dot")
        .attr("fill", (d) => winnerFill(data, areaFor(d), state)),
      areaFor,
      () => ctx,
    );
    if (isLand) {
      svg.append("g").attr("class", "labels on-fill")
        .selectAll("text")
        .data(items)
        .join("text")
        .attr("x", (d) => fit.x(d.x))
        .attr("y", (d) => fit.y(d.y))
        .attr("dy", "0.35em")
        .text((d) => d.id);
    }
  };
  draw();
  return { update: (c) => ((ctx = c), draw()), destroy: () => el.replaceChildren() };
}
