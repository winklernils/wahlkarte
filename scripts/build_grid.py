"""Fine-grained vote grid for the dense 2D spike map (population-spike-map style).

Steps (all inputs are official files from data/raw, see fetch_sources.py):
 1. Polling-district results (Wahlbezirksstatistik BTW 2025): ~95,000 rows, polling-station
    districts (Bezirksart 0) and postal districts (Bezirksart 5).
 2. Postal votes are NOT kept separate: each postal district's votes are distributed over the
    polling-station districts it serves, weighted by "Wahlberechtigte mit Sperrvermerk (A2)" =
    the people in each district who requested a postal ballot. A postal district serves
      - its own municipality (and Wahlkreis), or
      - for joint postal boards (Gemeinde code "9xx"), all municipalities of the same Kreis whose
        "Briefwahlzugehörigkeit" equals xx (official convention, see btw25_wbz_hinweise.pdf).
 3. Districts are summed per unit = municipality × Wahlkreis (big cities are split by Wahlkreis).
 4. Units get their official boundaries (BKG VG250 municipalities, cut by Wahlkreis where a city
    spans several Wahlkreise) and their votes are spread uniformly over their area onto a regular
    square grid (default 5 km) in ETRS89-LAEA.

Checks: every Wahlkreis total in the district file equals the official result (kerg2), and the
grid preserves every party's national total. Output: public/data/grid.json.
"""
import json
import os
import pathlib
import sys

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
INTERIM = ROOT / "data" / "interim"
PUB = ROOT / "public" / "data"
CELL_KM = float(os.environ.get("GRID_KM", "5"))
PARTIES = ["CDU", "CSU", "AfD", "SPD", "GRÜNE", "Die Linke", "BSW", "SSW"]
errors: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        errors.append(msg)


# ------------------------------------------------------------- 1. districts ---
wbz = pd.read_csv(RAW / "btw25_wbz" / "btw25_wbz_ergebnisse.csv", sep=";", skiprows=4,
                  encoding="utf-8-sig", dtype=str)
value_cols = {"eligible": "Wahlberechtigte (A)", "postal_eligible": "Wahlberechtigte mit Sperrvermerk (A2)",
              "voters": "Wählende (B)", "e_valid": "Gültige - Erststimmen", "z_valid": "Gültige - Zweitstimmen",
              "e_invalid": "Ungültige - Erststimmen", "z_invalid": "Ungültige - Zweitstimmen"}
# every party / candidate group in the file (needed for the municipality map), grid parties first
ALL_GROUPS = PARTIES + [c.rsplit(" - ", 1)[0] for c in wbz.columns
                        if c.endswith(" - Zweitstimmen") and not c.startswith(("Gültige", "Ungültige"))
                        and c.rsplit(" - ", 1)[0] not in PARTIES]
ALL_GROUPS += [c.rsplit(" - ", 1)[0] for c in wbz.columns
               if c.endswith(" - Erststimmen") and not c.startswith(("Gültige", "Ungültige"))
               and c.rsplit(" - ", 1)[0] not in ALL_GROUPS]
for p in ALL_GROUPS:
    for vk, suffix in (("e", "Erststimmen"), ("z", "Zweitstimmen")):
        if f"{p} - {suffix}" in wbz.columns:
            value_cols[f"{vk}_{p}"] = f"{p} - {suffix}"
missing = [c for c in value_cols.values() if c not in wbz.columns]
if missing:
    sys.exit(f"columns missing in district file: {missing}")
V = wbz[list(value_cols.values())].apply(pd.to_numeric, errors="coerce").fillna(0).to_numpy(float)
keys = list(value_cols)
wbz["wk"] = wbz["Wahlkreis"].astype(int)
wbz["kreis"] = wbz["Land"] + wbz["Regierungsbezirk"] + wbz["Kreis"]
wbz["ags"] = wbz["kreis"] + wbz["Gemeinde"]
art = wbz["Bezirksart"].to_numpy()

# official Wahlkreis totals (kerg2) for the check
k2 = pd.read_csv(RAW / "kerg2.csv", sep=";", skiprows=9, encoding="utf-8-sig", dtype=str)
k2 = k2[(k2.Gebietsart == "Wahlkreis") & (k2.Gruppenart == "Partei")]
k2["Anzahl"] = pd.to_numeric(k2.Anzahl, errors="coerce").fillna(0)
for p in PARTIES:
    for vk, st in (("e", "1"), ("z", "2")):
        off = k2[(k2.Gruppenname == p) & (k2.Stimme == st)].assign(wk=lambda x: x.Gebietsnummer.astype(int))
        off = off.groupby("wk").Anzahl.sum()
        mine = pd.Series(V[:, keys.index(f"{vk}_{p}")]).groupby(wbz["wk"]).sum()
        diff = (mine.reindex(off.index, fill_value=0) - off).abs()
        check(diff.max() == 0, f"district sum != official for {p}/{vk} in Wahlkreis {diff.idxmax()}")

# ---------------------------------------------- 2. distribute postal votes ---
urn = art == "0"
postal = art == "5"
shared = postal & wbz["Gemeinde"].str.startswith("9").to_numpy()
bwz = wbz["Kennziffer Briefwahlzugehörigkeit"].to_numpy()
# group key of every polling-station district for both kinds of postal board
own_key = wbz["wk"].astype(str) + "|" + wbz["ags"]
joint_key = wbz["wk"].astype(str) + "|" + wbz["kreis"] + "|" + pd.Series(bwz)
joint_key_any_wk = wbz["kreis"] + "|" + pd.Series(bwz)
postal_key = np.where(shared, joint_key.where(pd.Series(shared), ""), own_key)

A2 = V[:, keys.index("postal_eligible")]
A = V[:, keys.index("eligible")]
W = np.zeros_like(V)  # distributed values per district
W[~postal] = V[~postal]
unassigned = 0
groups_own = pd.Series(np.flatnonzero(urn)).groupby(own_key[urn].to_numpy()).apply(list).to_dict()
groups_joint = pd.Series(np.flatnonzero(urn & (bwz != "00"))).groupby(
    joint_key[urn & (bwz != "00")].to_numpy()).apply(list).to_dict()
groups_joint_any = pd.Series(np.flatnonzero(urn & (bwz != "00"))).groupby(
    joint_key_any_wk[urn & (bwz != "00")].to_numpy()).apply(list).to_dict()
for i in np.flatnonzero(postal):
    if shared[i]:
        code = wbz.at[i, "Gemeinde"][1:]
        members = groups_joint.get(f"{wbz.at[i, 'wk']}|{wbz.at[i, 'kreis']}|{code}") or \
            groups_joint_any.get(f"{wbz.at[i, 'kreis']}|{code}")
    else:
        members = groups_own.get(own_key[i])
    if not members:
        W[i] = V[i]  # no polling-station districts found: keep at its own municipality
        unassigned += 1
        continue
    m = np.array(members)
    w = A2[m] if A2[m].sum() > 0 else A[m]
    w = w / w.sum()
    W[m] += np.outer(w, V[i])
check(np.allclose(W.sum(0), V.sum(0)), "postal distribution changed national totals")
print(f"postal districts: {postal.sum()} ({shared.sum()} joint boards); kept in place: {unassigned}")

# ----------------------------------------------------- 3. units (Gemeinde × WK) ---
gem_all = gpd.read_file(next(RAW.rglob("VG250_GEM.shp")))
gem = gem_all[gem_all["GF"] == 4][["AGS", "geometry"]].dissolve(by="AGS").to_crs(3035)  # GF 4 = land areas
gem_full = gem.geometry.copy()  # unsimplified, for the municipality map (mapshaper simplifies with topology)
gem["geometry"] = gem.geometry.simplify(100)
gem_name = gem_all.drop_duplicates("AGS").set_index("AGS")["GEN"]
keep = ~postal | (W.sum(1) > 0)
df = pd.DataFrame(W[keep], columns=keys)
df["wk"] = wbz.loc[keep, "wk"].to_numpy()
df["ags"] = wbz.loc[keep, "ags"].to_numpy()
# Berlin and Hamburg report by city district (Bezirk), which has no official boundary in VG250:
# there the unit is the Wahlkreis itself
citystate = df.ags.str[:2].isin(["02", "11"])
df.loc[~df.ags.isin(gem.index) & citystate, "ags"] = "WK" + df.wk.astype(str).str.zfill(3)
# elsewhere a few special districts carry codes without a boundary: add them to the largest
# municipality of the same Wahlkreis rather than drawing a Wahlkreis-sized area
stray = ~df.ags.isin(gem.index) & ~citystate
if stray.any():
    biggest = df[~stray & ~citystate].groupby(["wk", "ags"]).eligible.sum().reset_index() \
        .sort_values("eligible").groupby("wk").ags.last()
    print(f"special districts without own boundary, added to their Wahlkreis' largest municipality: {int(stray.sum())}")
    df.loc[stray, "ags"] = df.loc[stray, "wk"].map(biggest)
units = df.groupby(["wk", "ags"], as_index=False).sum()
units = units[units[keys].sum(axis=1) > 0].reset_index(drop=True)
print(f"units (municipality × Wahlkreis): {len(units)}")

# ----------------------------------------------------- geometry of the units ---
wkg = gpd.read_file(INTERIM / "wahlkreise.geojson").to_crs(3035).set_index("id")
multi = units.groupby("ags").wk.nunique()
geoms, fallback = [], 0
for u in units.itertuples():
    g = gem.geometry.get(u.ags)
    if g is None:  # municipality code not in VG250: spread over the Wahlkreis instead
        geoms.append(wkg.geometry[u.wk])
        fallback += 1
        continue
    if multi[u.ags] > 1:  # city split over several Wahlkreise: cut by the Wahlkreis boundary
        part = g.intersection(wkg.geometry[u.wk].buffer(50))
        g = part if part.area > 0.05 * g.area / multi[u.ags] else g
    geoms.append(g)
units = gpd.GeoDataFrame(units, geometry=geoms, crs=3035)
units["uid"] = np.arange(len(units))
print(f"Wahlkreis-level units (Berlin/Hamburg districts without own boundary): {fallback}")

# --------------------------------------------- municipality map (Karte, level "Gemeinden") ---
res = json.loads((PUB / "results.json").read_text())
wk_land = {w["id"]: w["land"] for w in res["wahlkreise"]}
wk_name = {w["id"]: w["name"] for w in res["wahlkreise"]}
gem_parties = [p for p in ALL_GROUPS if f"z_{p}" in keys or f"e_{p}" in keys]
records = []
outside_winner = 0
for u in units.itertuples(index=False):
    row = u._asdict()
    rec = {"id": f"{u.wk}-{u.ags}", "wk": int(u.wk), "land": wk_land[u.wk],
           "name": wk_name[u.wk] if u.ags.startswith("WK") else str(gem_name.get(u.ags, u.ags)),
           "split": bool(multi[u.ags] > 1) and not u.ags.startswith("WK"),
           "eligible": round(row["eligible"]), "voters": round(row["voters"]),
           "valid": [round(row["e_valid"]), round(row["z_valid"])],
           "invalid": [round(row["e_invalid"]), round(row["z_invalid"])], "e": {}, "z": {}}
    for vk in ("e", "z"):
        vals = {p: row.get(f"{vk}_{p}", 0) for p in gem_parties}
        vals = {p: round(v) for p, v in vals.items() if round(v) > 0}
        rec[vk] = dict(sorted(vals.items(), key=lambda kv: -kv[1]))
    records.append(rec)
(PUB / "gemeinden.json").write_text(json.dumps(records, ensure_ascii=False, separators=(",", ":")))
map_geoms = []
for u in units.itertuples():
    if u.ags.startswith("WK"):
        map_geoms.append(wkg.geometry[u.wk])
    elif multi[u.ags] > 1:
        map_geoms.append(gem_full[u.ags].intersection(wkg.geometry[u.wk]))
    else:
        map_geoms.append(gem_full[u.ags])
gpd.GeoDataFrame({"id": [r["id"] for r in records]}, geometry=map_geoms, crs=3035) \
    .to_crs(4326).to_file(INTERIM / "gemeinden.geojson", driver="GeoJSON")
print(f"municipality map: {len(records)} areas written")

# ------------------------------------------------------------- 4. the grid ---
S = CELL_KM * 1000
minx, miny, maxx, maxy = units.total_bounds
xs = np.arange(np.floor(minx / S) * S, maxx + S, S)
ys = np.arange(np.floor(miny / S) * S, maxy + S, S)
gx, gy = np.meshgrid(xs, ys)
cells = gpd.GeoDataFrame({"mx": gx.ravel() + S / 2, "my": gy.ravel() + S / 2},
                         geometry=shapely.box(gx.ravel(), gy.ravel(), gx.ravel() + S, gy.ravel() + S), crs=3035)
cells["cid"] = np.arange(len(cells))
pieces = gpd.overlay(units[["uid", "geometry"]], cells[["cid", "geometry"]], how="intersection", keep_geom_type=True)
pieces["a"] = pieces.area
pieces["w"] = pieces.a / pieces.groupby("uid").a.transform("sum")
vals = units[keys].to_numpy()
cell_vals = np.zeros((len(cells), len(keys)))
np.add.at(cell_vals, pieces.cid.to_numpy(), vals[pieces.uid.to_numpy()] * pieces.w.to_numpy()[:, None])
missing_units = set(units.uid) - set(pieces.uid)
check(not missing_units, f"{len(missing_units)} units did not intersect the grid")
check(np.allclose(cell_vals.sum(0), vals.sum(0), rtol=1e-6), "grid lost votes")

# dominant Wahlkreis per cell (largest vote contribution) for hover and CDU/CSU colouring
pieces["votes"] = vals[pieces.uid.to_numpy(), keys.index("z_valid")] * pieces.w
dom = pieces.assign(wk=units.wk.to_numpy()[pieces.uid.to_numpy()]).sort_values("votes").groupby("cid").wk.last()
live = np.flatnonzero(cell_vals[:, keys.index("z_valid")] > 0.5)
cent = gpd.GeoSeries(gpd.points_from_xy(cells.mx.to_numpy()[live], cells.my.to_numpy()[live]), crs=3035).to_crs(4326)

if errors:
    print("GRID CHECKS FAILED:\n  " + "\n  ".join(errors), file=sys.stderr)
    sys.exit(1)

out = {
    "cell_km": CELL_KM,
    "lon": [round(p.x, 4) for p in cent],
    "lat": [round(p.y, 4) for p in cent],
    "wk": [int(dom.get(c, 0)) for c in live],
    "e": {p: np.rint(cell_vals[live, keys.index(f"e_{p}")]).astype(int).tolist() for p in PARTIES},
    "z": {p: np.rint(cell_vals[live, keys.index(f"z_{p}")]).astype(int).tolist() for p in PARTIES},
}
out["e"]["valid"] = np.rint(cell_vals[live, keys.index("e_valid")]).astype(int).tolist()
out["z"]["valid"] = np.rint(cell_vals[live, keys.index("z_valid")]).astype(int).tolist()
(PUB / "grid.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
z = cell_vals[live, keys.index("z_valid")]
print(f"OK: {len(live)} grid cells of {CELL_KM:g} km, valid Zweitstimmen per cell: "
      f"median {np.median(z):,.0f}, max {z.max():,.0f}; all checks passed")
