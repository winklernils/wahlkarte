"""Download the official BTW 2025 files from Die Bundeswahlleiterin and record provenance.

Writes data/raw/<file> and public/data/sources.json (URL, retrieval date, SHA-256, licence).
"""
import datetime as dt
import hashlib
import json
import pathlib
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "public" / "data" / "sources.json"
BASE = "https://www.bundeswahlleiterin.de"

SOURCES = [
    {
        "id": "kerg2",
        "file": "kerg2.csv",
        "url": f"{BASE}/bundestagswahlen/2025/ergebnisse/opendata/btw25/csv/kerg2.csv",
        "title_de": "Endgültiges Ergebnis der Bundestagswahl 2025 (Wahlkreise, Länder, Bund), Open-Data-CSV im Langformat",
        "title_en": "Final official result of the 2025 Bundestag election (constituencies, states, federal), open-data CSV, long format",
        "page": f"{BASE}/bundestagswahlen/2025/ergebnisse/opendata.html",
        "licence": "© Die Bundeswahlleiterin, Wiesbaden 2025; Datenlizenz Deutschland – Namensnennung – Version 2.0 (dl-de/by-2-0)",
    },
    {
        "id": "strukturdaten",
        "file": "btw2025_strukturdaten.csv",
        "url": f"{BASE}/dam/jcr/181f9e38-38db-4f64-991c-8141dfa0f2cb/btw2025_strukturdaten.csv",
        "title_de": "Strukturdaten der Wahlkreise zur Bundestagswahl 2025",
        "title_en": "Structural data of the constituencies, 2025 Bundestag election",
        "page": f"{BASE}/bundestagswahlen/2025/ergebnisse/opendata.html",
        "licence": "© Die Bundeswahlleiterin, Wiesbaden 2024 (Quelle: Statistische Ämter des Bundes und der Länder); dl-de/by-2-0",
    },
    {
        "id": "geometry",
        "file": "btw25_geometrie_wahlkreise_shp_geo.zip",
        "url": f"{BASE}/dam/jcr/556bec9c-be80-4818-a368-fe6596f15f08/btw25_geometrie_wahlkreise_shp_geo.zip",
        "title_de": "Wahlkreisgeometrien Bundestagswahl 2025 (generalisiert, Shapefile, geografische Koordinaten)",
        "title_en": "Constituency boundaries, 2025 Bundestag election (generalised, shapefile, geographic coordinates)",
        "page": f"{BASE}/bundestagswahlen/2025/wahlkreiseinteilung/downloads.html",
        "licence": "© Die Bundeswahlleiterin, Wiesbaden 2024; Wahlkreise: Statistische Ämter des Bundes und der Länder; Geometrische Grundlage: © GeoBasis-DE / BKG (dl-de/by-2-0)",
    },
    {
        "id": "wahlbezirke",
        "file": "btw25_wbz.zip",
        "url": f"{BASE}/dam/jcr/e79a7bd3-0607-4e87-9752-8e601e299e00/btw25_wbz.zip",
        "title_de": "Wahlbezirksstatistik zur Bundestagswahl 2025: Ergebnisse aller Urnen- und Briefwahlbezirke",
        "title_en": "Polling-district statistics, 2025 Bundestag election: results of all polling-station and postal districts",
        "page": f"{BASE}/bundestagswahlen/2025/ergebnisse/weitere-ergebnisse.html",
        "licence": "© Die Bundeswahlleiterin (im Auftrag der Herausgebergemeinschaft), Wiesbaden 2025; dl-de/by-2-0",
    },
    {
        "id": "gemeinden",
        "file": "vg250_12-31.utm32s.shape.ebenen.zip",
        "url": "https://daten.gdz.bkg.bund.de/produkte/vg/vg250_ebenen_1231/2024/vg250_12-31.utm32s.shape.ebenen.zip",
        "title_de": "Verwaltungsgebiete 1:250 000 (VG250), Gebietsstand 31.12.2024 – Gemeindegrenzen",
        "title_en": "Administrative areas 1:250,000 (VG250), as of 31 Dec 2024 – municipality boundaries",
        "page": "https://gdz.bkg.bund.de/index.php/default/verwaltungsgebiete-1-250-000-stand-31-12-vg250-31-12.html",
        "licence": "© GeoBasis-DE / BKG (2024), Bundesamt für Kartographie und Geodäsie; dl-de/by-2-0",
    },
]


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    out = []
    for s in SOURCES:
        dest = RAW / s["file"]
        req = urllib.request.Request(s["url"], headers={"User-Agent": "wahlkarte-data-pipeline"})
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
        dest.write_bytes(data)
        if dest.suffix == ".zip":
            with zipfile.ZipFile(dest) as z:
                z.extractall(RAW / dest.stem)
        entry = {**s, "retrieved": dt.date.today().isoformat(),
                 "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
        out.append(entry)
        print(f"{s['id']:14} {len(data):>10} bytes  {entry['sha256'][:16]}…")
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
