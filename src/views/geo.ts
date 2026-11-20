import type { Feature, Geometry } from "geojson";
import { t } from "../i18n";
import { type ViewCtx, type ViewHandle, interactive, svgIn, winnerFill } from "./common";
import { projectionFor } from "./projection";

/** Traditional geographic map, coloured by the strongest party: Länder, Wahlkreise or Gemeinden. */
export function geoView(el: HTMLElement, ctx0: ViewCtx): ViewHandle {
  let ctx = ctx0;
  const draw = () => {
    const { data, state } = ctx;
    const { path } = projectionFor(data);
    const svg = svgIn(el, t("view.geo"));
    const g = svg.append("g");
    if (state.level === "gem" && data.gem) {
      // unincorporated areas (forests, military grounds) have no voters: neutral background
      g.append("g").selectAll("path").data(data.landFeatures.features).join("path")
        .attr("d", path).attr("class", "gem-background");
      interactive(
        g.append("g").selectAll<SVGPathElement, Feature<Geometry, { id: string }>>("path")
          .data(data.gem.features.features)
          .join("path")
          .attr("d", path)
          .attr("fill", (f) => winnerFill(data, { kind: "gem", id: f.properties.id }, state))
          .attr("class", "gem-shape"),
        (f) => ({ kind: "gem", id: f.properties.id }),
        () => ctx,
      );
      svg.append("g").selectAll("path").data(data.wkFeatures.features).join("path")
        .attr("d", path).attr("class", "wk-border");
    }
    if (state.level === "wk") {
      interactive(
        g.selectAll<SVGPathElement, Feature<Geometry, { id: number }>>("path")
          .data(data.wkFeatures.features)
          .join("path")
          .attr("d", path)
          .attr("fill", (f) => winnerFill(data, { kind: "wk", id: f.properties.id }, state))
          .attr("class", "wk-shape"),
        (f) => ({ kind: "wk", id: f.properties.id }),
        () => ctx,
      );
    }
    const lands = svg.append("g");
    const ls = lands
      .selectAll<SVGPathElement, Feature<Geometry, { land: string }>>("path")
      .data(data.landFeatures.features)
      .join("path")
      .attr("d", path)
      .attr("class", state.level === "land" ? "land-shape" : "land-border");
    if (state.level === "land") {
      ls.attr("fill", (f) => winnerFill(data, { kind: "land", id: f.properties.land }, state));
      interactive(ls, (f) => ({ kind: "land", id: f.properties.land }), () => ctx);
    }
  };
  draw();
  return { update: (c) => ((ctx = c), draw()), destroy: () => el.replaceChildren() };
}
