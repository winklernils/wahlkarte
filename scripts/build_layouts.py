"""Compute the cartogram layouts (hexagons and Dorling circles) from official data.

Coordinates are in km in the ETRS89-LAEA projection (EPSG:3035), y pointing north.
Outputs public/data/layout_hex.json and public/data/layout_circles.json.
Manual hex tweaks can go into scripts/hex_overrides.json as {"<wk id>": [col, row]}.
"""
import json
import math
import pathlib
from collections import deque

import geopandas as gpd
import numpy as np
import shapely
import shapely.affinity
from scipy.optimize import linear_sum_assignment
from scipy.spatial import cKDTree

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUB = ROOT / "public" / "data"
INTERIM = ROOT / "data" / "interim"

res = json.loads((PUB / "results.json").read_text())
cents = json.loads((INTERIM / "centroids.json").read_text())
WK = res["wahlkreise"]
ids = [r["id"] for r in WK]
land = np.array([r["land"] for r in WK])
P0 = np.array([[cents[str(i)]["x"], cents[str(i)]["y"]] for i in ids])
GERMANY_KM2 = 357_684
rng = np.random.default_rng(42)


def relax(p0, radii, iters=600, pull=0.02, pad=1.0, groups=None, cohesion=0.0, gravity=0.0):
    """Collision relaxation (Dorling): push overlapping circles apart, pull each to its origin.

    cohesion pulls members of a group (Land) toward the group's current mean (keeps Länder compact);
    gravity pulls everything toward the overall centre (closes gaps in sparse regions).
    """
    p = p0.copy() + rng.normal(0, 0.01, p0.shape)
    centre = p0.mean(axis=0)
    for it in range(iters):
        if groups is not None and cohesion:
            for g in np.unique(groups):
                m = groups == g
                p[m] += (p[m].mean(axis=0) - p[m]) * cohesion
        if gravity:
            p += (centre - p) * gravity
        tree = cKDTree(p)
        for i, j in tree.query_pairs(2 * radii.max() * pad):
            d = p[j] - p[i]
            dist = math.hypot(*d) or 1e-6
            overlap = (radii[i] + radii[j]) * pad - dist
            if overlap > 0:
                shift = d / dist * overlap / 2
                p[i] -= shift
                p[j] += shift
        p += (p0 - p) * pull
    return p


# ---------------------------------------------------------------- hexagons ---
# Tile-map approach (as in US election tile maps): first fill Germany's real outline with exactly
# one hexagon cell per Wahlkreis, then assign Wahlkreise to cells. The outline stays intact and
# dense regions (Ruhr, Berlin) push their neighbours outward instead of bulging out of the country.
outline = gpd.read_file(INTERIM / "wahlkreise.geojson").to_crs(3035).union_all()
outline = shapely.affinity.scale(outline, 1 / 1000, 1 / 1000, origin=(0, 0)).simplify(2)
N = len(WK)
import os
BLEND = float(os.environ.get("HEX_BLEND", "0.6"))  # 0 = density-evened positions, 1 = raw centroids


def grid(side_, ox=0.0, oy=0.0):
    dx_, dy_ = math.sqrt(3) * side_, 1.5 * side_
    minx, miny, maxx, maxy = outline.bounds
    rows = range(int(miny // dy_) - 1, int(maxy // dy_) + 2)
    cols = range(int(minx // dx_) - 2, int(maxx // dx_) + 2)
    keys = [(c, r) for r in rows for c in cols]
    xy = np.array([[c * dx_ + (dx_ / 2 if r % 2 else 0) + ox, r * dy_ + oy] for c, r in keys])
    inside = shapely.contains_xy(outline, xy[:, 0], xy[:, 1])
    return dx_, dy_, [k for k, ok in zip(keys, inside) if ok]


def neighbours(col, row):
    odd = row % 2
    for dc, dr in [(-1, 0), (1, 0), (-1 + odd, -1), (odd, -1), (-1 + odd, 1), (odd, 1)]:
        yield col + dc, row + dr


# choose cell size and grid offset so that close to N cells fall inside the outline
best = None
for ox in np.linspace(0, 30, 4):
    for oy in np.linspace(0, 30, 4):
        lo, hi = 10.0, 40.0
        for _ in range(40):
            mid = (lo + hi) / 2
            n = len(grid(mid, ox, oy)[2])
            lo, hi = (mid, hi) if n > N else (lo, mid)
        for side_try in (lo, hi):
            dx_, dy_, keys = grid(side_try, ox, oy)
            if len(keys) >= N and (best is None or len(keys) < len(best[3]) or
                                   (len(keys) == len(best[3]) and side_try > best[0])):
                best = (side_try, ox, oy, keys, dx_, dy_)
side, OX, OY, cell_keys, dx, dy = best
cellset = set(cell_keys)
# trim surplus cells: drop the most exposed ones (fewest neighbours) first
while len(cellset) > N:
    worst = min(cellset, key=lambda k: (sum(n in cellset for n in neighbours(*k)), k[1]))
    cellset.discard(worst)
cell_keys = sorted(cellset)
print(f"hex grid: side {side:.2f} km, {len(cell_keys)} cells inside the outline")


def hex_center(col, row):
    return np.array([col * dx + (dx / 2 if row % 2 else 0) + OX, row * dy + OY])


C = np.array([hex_center(*k) for k in cell_keys])
# 1) even out density: equal-size discs pushed apart (Länder kept together), so every Wahlkreis
#    claims about the same area; 2) stretch that blob onto the cell set (match mean and spread);
# 3) optimal transport onto the cells (squared distance keeps the relative order)
spread = relax(P0, np.full(N, dx / 2), iters=500, pull=0.01, pad=1.0, groups=land, cohesion=0.01, gravity=0.004)
spread = (spread - spread.mean(0)) / spread.std(0) * C.std(0) + C.mean(0)
SRC = (1 - BLEND) * spread + BLEND * P0
ri, ci = linear_sum_assignment(((SRC[:, None, :] - C[None, :, :]) ** 2).sum(-1))
pos = {i: cell_keys[c] for i, c in zip(ri, ci)}
occ = {c: i for i, c in pos.items()}
target = {i: hex_center(*pos[i]) for i in pos}  # transport target, used as anchor during clean-up


def components(L):
    members = [i for i in range(N) if land[i] == L]
    left, comps = set(members), []
    while left:
        start = left.pop()
        comp, q = {start}, deque([start])
        while q:
            i = q.popleft()
            for n in neighbours(*pos[i]):
                j = occ.get(n)
                if j is not None and land[j] == L and j in left:
                    left.discard(j)
                    comp.add(j)
                    q.append(j)
        comps.append(comp)
    return sorted(comps, key=len, reverse=True)


def score(i, cell):
    """Lower is better: distance from the transport target plus a penalty for foreign neighbours."""
    disp = np.linalg.norm(hex_center(*cell) - target[i]) / dx
    foreign = sum(1 for n in neighbours(*cell) if n in occ and land[occ[n]] != land[i])
    return 0.35 * disp + foreign


def swap(i, j):
    a, b = pos[i], pos[j]
    pos[i], pos[j] = b, a
    occ[a], occ[b] = j, i


# local search: swap neighbouring cells of different Länder when it makes Länder more compact
for sweep in range(80):
    improved = 0
    for i in rng.permutation(N):
        for n in list(neighbours(*pos[i])):
            j = occ.get(n)
            if j is None or land[j] == land[i]:
                continue
            before = score(i, pos[i]) + score(j, pos[j])
            swap(i, j)
            if score(i, pos[i]) + score(j, pos[j]) < before - 1e-9:
                improved += 1
                break
            swap(i, j)
    if not improved:
        break

# contiguity repair: move fragments next to the main body of their Land by swapping
for _ in range(400):
    split = [L for L in sorted(set(land)) if len(components(L)) > 1]
    if not split:
        break
    L = split[0]
    comps = components(L)
    main, frag = comps[0], min(comps[1:], key=len)
    targets = {n for i in main for n in neighbours(*pos[i]) if n in occ and land[occ[n]] != L}
    done = False
    for i in frag:
        for t in sorted(targets, key=lambda t: np.linalg.norm(hex_center(*t) - hex_center(*pos[i]))):
            j = occ[t]
            swap(i, j)
            if len(components(land[j])) == 1 or len(components(land[j])) <= len(split):
                if len(components(land[j])) == 1:
                    done = True
                    break
            swap(i, j)
        if done:
            break
    if not done:
        print(f"repair: could not attach fragment of {L}")
        break

overrides_f = ROOT / "scripts" / "hex_overrides.json"
if overrides_f.exists():
    for k, (c, r) in json.loads(overrides_f.read_text()).items():
        i = ids.index(int(k))
        j = occ.get((c, r))
        if j is not None:
            swap(i, j)
        else:
            print(f"override for {k} ignored: cell {c},{r} is outside the outline")

for L in sorted(set(land)):
    n = len(components(L))
    print(f"hex {L}: {int((land == L).sum()):3d} cells, " + ("contiguous" if n == 1 else f"SPLIT into {n}"))
disp = [np.linalg.norm(hex_center(*pos[i]) - P0[i]) for i in range(N)]
print(f"hex mean displacement {np.mean(disp):.1f} km, max {np.max(disp):.1f} km")
hex_out = {"side": round(side, 3), "dx": round(dx, 3), "dy": round(dy, 3),
           "cells": [{"id": ids[i], "land": land[i], "col": int(pos[i][0]), "row": int(pos[i][1]),
                      "x": round(float(hex_center(*pos[i])[0]), 2), "y": round(float(hex_center(*pos[i])[1]), 2)}
                     for i in range(N)]}
(PUB / "layout_hex.json").write_text(json.dumps(hex_out, separators=(",", ":")))

# ----------------------------------------------------------------- circles ---
# area ∝ size measure; total circle area ≈ 60 % of Germany so the map keeps its outline
def dorling(points, sizes, frac=0.6, iters=500):
    sizes = np.asarray(sizes, float)
    k = math.sqrt(frac * GERMANY_KM2 / (math.pi * sizes.sum()))
    radii = k * np.sqrt(sizes)
    p = relax(points, radii, iters=iters, pull=0.02, pad=1.03)
    return p, radii, k


circles = {"wahlkreis": {}, "land": {}}
land_ids = [l["id"] for l in res["laender"]]
LP = np.array([P0[land == L].mean(axis=0) for L in land_ids])
for measure in ("eligible", "valid"):
    sizes = [r["eligible"] if measure == "eligible" else r["valid"][1] for r in WK]
    p, rad, k = dorling(P0, sizes)
    circles["wahlkreis"][measure] = {"k": round(k, 6), "items": [
        {"id": ids[i], "x": round(float(p[i, 0]), 2), "y": round(float(p[i, 1]), 2), "r": round(float(rad[i]), 2)}
        for i in range(len(WK))]}
    lsizes = [l["eligible"] if measure == "eligible" else l["valid"][1] for l in res["laender"]]
    p, rad, k = dorling(LP, lsizes, frac=0.6, iters=800)
    circles["land"][measure] = {"k": round(k, 6), "items": [
        {"id": land_ids[i], "x": round(float(p[i, 0]), 2), "y": round(float(p[i, 1]), 2), "r": round(float(rad[i]), 2)}
        for i in range(len(land_ids))]}
(PUB / "layout_circles.json").write_text(json.dumps(circles, separators=(",", ":")))
print("circles written")
