"""Turn the official BTW 2025 files into compact JSON for the website, and validate them.

Inputs  (data/raw, from fetch_sources.py):
  kerg2.csv, btw2025_strukturdaten.csv, btw25_geometrie_wahlkreise_shp_geo/*.shp
Outputs:
  public/data/results.json         results per Wahlkreis, Land, Bund
  data/interim/wahlkreise.geojson  geometry with attributes, simplified later by mapshaper
  data/interim/centroids.json      label points (lon/lat) and LAEA points (km) per Wahlkreis

The script stops with an error if any consistency check fails.
"""
import json
import pathlib
import sys

import geopandas as gpd
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
INTERIM = ROOT / "data" / "interim"
PUB = ROOT / "public" / "data"

LAND_ABBR = {
    "01": "SH", "02": "HH", "03": "NI", "04": "HB", "05": "NW", "06": "HE", "07": "RP", "08": "BW",
    "09": "BY", "10": "SL", "11": "BE", "12": "BB", "13": "MV", "14": "SN", "15": "ST", "16": "TH",
}
# Official national figures, used as an independent plausibility check (Bundeswahlleiterin, 14.03.2025).
EXPECTED_TURNOUT = 82.5
EXPECTED_ELIGIBLE = 60_510_631

errors: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        errors.append(msg)


def num(s) -> int:
    return 0 if pd.isna(s) or s == "" else int(s)


def load_results() -> pd.DataFrame:
    d = pd.read_csv(RAW / "kerg2.csv", sep=";", skiprows=9, encoding="utf-8-sig", dtype=str)
    meta = (RAW / "kerg2.csv").read_text(encoding="utf-8-sig").splitlines()[:6]
    check(any("Endgültig" in line for line in meta), "kerg2.csv is not marked as final result (Endgültig)")
    d["Anzahl"] = d["Anzahl"].map(num)
    return d


def area_record(g: pd.DataFrame) -> dict:
    sysg = g[g.Gruppenart == "System-Gruppe"]

    def sys_val(name, stimme=None):
        s = sysg[sysg.Gruppenname == name]
        if stimme:
            s = s[s.Stimme == stimme]
        return int(s.Anzahl.sum())

    rec = {
        "eligible": sys_val("Wahlberechtigte"),
        "voters": sys_val("Wählende"),
        "invalid": [sys_val("Ungültige", "1"), sys_val("Ungültige", "2")],
        "valid": [sys_val("Gültige", "1"), sys_val("Gültige", "2")],
        "e": {}, "z": {},
    }
    cand = g[g.Gruppenart.isin(["Partei", "Einzelbewerber/Wählergruppe"])]
    for _, r in cand.iterrows():
        if r.Anzahl <= 0:
            continue
        name = r.Gruppenname if r.Gruppenart == "Partei" else f"EB: {r.Gruppenname}"
        key = "e" if r.Stimme == "1" else "z"
        rec[key][name] = rec[key].get(name, 0) + int(r.Anzahl)
    for key in ("e", "z"):
        rec[key] = dict(sorted(rec[key].items(), key=lambda kv: -kv[1]))
    return rec


def main() -> None:
    INTERIM.mkdir(parents=True, exist_ok=True)
    d = load_results()

    # --- Wahlkreise -------------------------------------------------------
    wk = []
    for nr, g in d[d.Gebietsart == "Wahlkreis"].groupby("Gebietsnummer", sort=True):
        rec = area_record(g)
        first = g.iloc[0]
        seated = g.Gewählt.dropna().iloc[0] if g.Gewählt.notna().any() else None
        rec = {"id": int(nr), "name": first.Gebietsname, "land": LAND_ABBR[first.UegGebietsnummer],
               "seated": None if seated in (None, "–", "-") else seated, **rec}
        wk.append(rec)

    # --- Länder and Bund --------------------------------------------------
    laender = []
    for nr, g in d[d.Gebietsart == "Land"].groupby("Gebietsnummer", sort=True):
        laender.append({"id": LAND_ABBR[nr], "nr": nr, "name": g.iloc[0].Gebietsname, **area_record(g)})
    bund = {"name": "Bundesgebiet", **area_record(d[d.Gebietsart == "Bund"])}

    # --- Strukturdaten: population and area ------------------------------
    s = pd.read_csv(RAW / "btw2025_strukturdaten.csv", sep=";", skiprows=9, encoding="utf-8-sig",
                    dtype=str)
    s = s[pd.to_numeric(s["Wahlkreis-Nr."], errors="coerce") < 900]
    pop = {int(r["Wahlkreis-Nr."]): float(r.iloc[5].replace(".", "").replace(",", ".")) * 1000
           for _, r in s.iterrows()}
    area = {int(r["Wahlkreis-Nr."]): float(r.iloc[4].replace(".", "").replace(",", "."))
            for _, r in s.iterrows()}
    for r in wk:
        r["pop"] = round(pop.get(r["id"], 0))
        r["area"] = round(area.get(r["id"], 0), 1)

    # --- Consistency checks ----------------------------------------------
    check(len(wk) == 299, f"expected 299 Wahlkreise, got {len(wk)}")
    check(len(laender) == 16, f"expected 16 Länder, got {len(laender)}")
    check(all(r["pop"] > 0 for r in wk), "missing population for some Wahlkreise")
    check(bund["eligible"] == EXPECTED_ELIGIBLE, f"eligible voters {bund['eligible']} != {EXPECTED_ELIGIBLE}")
    turnout = 100 * bund["voters"] / bund["eligible"]
    check(abs(turnout - EXPECTED_TURNOUT) < 0.05, f"turnout {turnout:.2f} != {EXPECTED_TURNOUT}")
    for key in ("e", "z"):
        parties = set(bund[key])
        for p in parties:
            if p.startswith("EB: "):
                continue
            s_wk = sum(r[key].get(p, 0) for r in wk)
            s_l = sum(r[key].get(p, 0) for r in laender)
            check(s_wk == s_l == bund[key][p], f"{key}/{p}: WK {s_wk} / Länder {s_l} / Bund {bund[key][p]}")
        for lnd in laender:
            s_wk = sum(r["valid"][0 if key == "e" else 1] for r in wk if r["land"] == lnd["id"])
            check(s_wk == lnd["valid"][0 if key == "e" else 1], f"valid votes {key} mismatch in {lnd['id']}")
    for r in wk + laender + [bund]:
        for i, key in enumerate(("e", "z")):
            check(sum(r[key].values()) == r["valid"][i], f"{r['name']}: party sum != valid votes ({key})")
        check(r["voters"] == r["valid"][1] + r["invalid"][1], f"{r['name']}: voters != valid+invalid")
    check(sum(1 for r in wk if r["seated"] is None) == 23,
          f"expected 23 Wahlkreis winners without seat, got {sum(1 for r in wk if r['seated'] is None)}")

    # --- Geometry ----------------------------------------------------------
    shp = next((RAW / "btw25_geometrie_wahlkreise_shp_geo").glob("*.shp"))
    geo = gpd.read_file(shp)
    geo["id"] = geo["WKR_NR"].astype(int)
    geo["land"] = geo["LAND_NR"].map(LAND_ABBR)
    check(sorted(geo.id) == sorted(r["id"] for r in wk), "geometry ids do not match result ids")
    land_by_id = {r["id"]: r["land"] for r in wk}
    check(all(land_by_id[i] == l for i, l in zip(geo.id, geo.land)), "geometry Land assignment mismatch")
    geo[["id", "land", "geometry"]].sort_values("id").to_file(INTERIM / "wahlkreise.geojson", driver="GeoJSON")

    laea = geo.to_crs(3035)
    cents = {}
    for (_, g4326), (_, g3035) in zip(geo.iterrows(), laea.iterrows()):
        # label point: centroid of the largest part, moved inside if necessary
        poly = max(getattr(g3035.geometry, "geoms", [g3035.geometry]), key=lambda p: p.area)
        pt = poly.centroid if poly.contains(poly.centroid) else poly.representative_point()
        ll = gpd.GeoSeries([pt], crs=3035).to_crs(4326).iloc[0]
        cents[int(g4326.id)] = {"lon": round(ll.x, 5), "lat": round(ll.y, 5),
                                "x": round(pt.x / 1000, 2), "y": round(pt.y / 1000, 2)}
    (INTERIM / "centroids.json").write_text(json.dumps(cents))
    for r in wk:
        r["lon"], r["lat"] = cents[r["id"]]["lon"], cents[r["id"]]["lat"]

    # Land label points: pole of inaccessibility of the largest part (keeps Brandenburg's point
    # outside Berlin and Bremen's on the city, not on Bremerhaven)
    from shapely.ops import polylabel
    land_geo = laea.dissolve(by="land")
    land_pt = {}
    for lid, row in land_geo.iterrows():
        poly = max(getattr(row.geometry, "geoms", [row.geometry]), key=lambda p: p.area)
        pt = polylabel(poly, tolerance=500)
        ll = gpd.GeoSeries([pt], crs=3035).to_crs(4326).iloc[0]
        land_pt[lid] = (round(ll.x, 5), round(ll.y, 5))
    for lnd in laender:
        lnd["lon"], lnd["lat"] = land_pt[lnd["id"]]

    if errors:
        print("DATA CHECKS FAILED:\n  " + "\n  ".join(errors), file=sys.stderr)
        sys.exit(1)

    meta = {"election": "Bundestagswahl 2025", "date": "2025-02-23", "status": "Endgültiges Ergebnis",
            "status_date": "2025-03-14"}
    PUB.mkdir(parents=True, exist_ok=True)
    (PUB / "results.json").write_text(json.dumps(
        {"meta": meta, "bund": bund, "laender": laender, "wahlkreise": wk},
        ensure_ascii=False, separators=(",", ":")))
    print(f"OK: {len(wk)} Wahlkreise, {len(laender)} Länder, turnout {turnout:.2f} %, all checks passed")


if __name__ == "__main__":
    main()
