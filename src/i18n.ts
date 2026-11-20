export type Lang = "de" | "en";

const dict = {
  title: { de: "Bundestagswahl 2025", en: "2025 German federal election" },
  subtitle: {
    de: "Endgültiges amtliches Ergebnis vom 14. März 2025 · 299 Wahlkreise · 16 Länder",
    en: "Final official result of 14 March 2025 · 299 constituencies · 16 states",
  },
  view: { de: "Ansicht", en: "View" },
  "view.geo": { de: "Karte", en: "Map" },
  "view.hex": { de: "Hexagone", en: "Hexagons" },
  "view.circles": { de: "Kreise", en: "Circles" },
  "view.spikes": { de: "Stimmen 2D", en: "Votes 2D" },
  "view.relief": { de: "Stimmen 3D", en: "Votes 3D" },
  level: { de: "Ebene", en: "Level" },
  "level.wk": { de: "Wahlkreise", en: "Constituencies" },
  "level.land": { de: "Länder", en: "States" },
  "level.gem": { de: "Gemeinden", en: "Municipalities" },
  legendGem: {
    de: "Feinste amtlich abgegrenzte Ebene: Gemeinden (BKG VG250), bei Großstädten je Wahlkreis geteilt; Berlin und Hamburg je Wahlkreis. Summe aller Wahlbezirke, Briefwahl auf die zugehörigen Urnenwahlbezirke verteilt.",
    en: "Finest level with official boundaries: municipalities (BKG VG250), large cities split by constituency; Berlin and Hamburg by constituency. Sum of all polling districts, postal votes distributed to their polling-station districts.",
  },
  gemSplit: { de: "Teil im Wahlkreis", en: "part in constituency" },
  vote: { de: "Stimme", en: "Vote" },
  "vote.e": { de: "Erststimme", en: "First vote" },
  "vote.z": { de: "Zweitstimme", en: "Second vote" },
  party: { de: "Partei", en: "Party" },
  size: { de: "Kreisgröße", en: "Circle size" },
  "size.eligible": { de: "Wahlberechtigte", en: "Eligible voters" },
  "size.valid": { de: "Gültige Stimmen", en: "Valid votes" },
  shading: { de: "Vorsprung zeigen", en: "Show margin" },
  scale: { de: "Höhenskala", en: "Height scale" },
  "scale.shared": { de: "Für alle Parteien gleich", en: "Same for all parties" },
  "scale.party": { de: "Je Partei", en: "Per party" },
  relief: { de: "Darstellung", en: "Style" },
  resolution: { de: "Auflösung", en: "Resolution" },
  "res.grid": { de: "Raster 5 km", en: "5 km grid" },
  legendGrid: {
    de: "Höhe = absolute Stimmenzahl je 5-km-Rasterzelle (Ergebnisse aller Wahlbezirke, Briefwahl auf die zugehörigen Urnenwahlbezirke verteilt)",
    en: "Height = absolute votes per 5 km grid cell (all polling districts; postal votes distributed to their polling-station districts)",
  },
  "relief.columns": { de: "Säulen", en: "Columns" },
  "relief.areas": { de: "Flächen", en: "Areas" },
  resetView: { de: "Ansicht zurücksetzen", en: "Reset view" },
  search: { de: "Wahlkreis suchen …", en: "Find constituency …" },
  winner: { de: "Stärkste Partei", en: "Largest party" },
  margin: { de: "Vorsprung", en: "Margin" },
  pp: { de: "Pp.", en: "pts" },
  turnout: { de: "Wahlbeteiligung", en: "Turnout" },
  eligible: { de: "Wahlberechtigte", en: "Eligible voters" },
  validVotes: { de: "Gültige Stimmen", en: "Valid votes" },
  population: { de: "Einwohner", en: "Population" },
  votes: { de: "Stimmen", en: "votes" },
  notOnBallot: { de: "nicht auf dem Stimmzettel", en: "not on the ballot" },
  noSeat: {
    de: "Wahlkreis gewonnen, aber kein Mandat (Zweitstimmendeckung)",
    en: "Won the constituency but got no seat (second-vote coverage rule)",
  },
  seat: { de: "Direktmandat", en: "Direct seat" },
  notInBundestag: { de: "nicht im Bundestag (4,98 %)", en: "not in the Bundestag (4.98 %)" },
  sources: { de: "Quellen & Methode", en: "Sources & method" },
  close: { de: "Schließen", en: "Close" },
  national: { de: "Bundesergebnis", en: "National result" },
  others: { de: "Sonstige", en: "Others" },
  legendSpikes: { de: "Höhe = absolute Stimmenzahl im Wahlkreis", en: "Height = absolute votes in the constituency" },
  legendSpikesLand: { de: "Höhe = absolute Stimmenzahl im Land", en: "Height = absolute votes in the state" },
  legendHex: {
    de: "Ein Hexagon je Wahlkreis. Wahlkreise haben fast gleich viele Einwohner, daher bildet die Fläche die Bevölkerung ab.",
    en: "One hexagon per constituency. Constituencies have nearly equal populations, so area reflects population.",
  },
  legendCircles: { de: "Kreisfläche ∝ {m}", en: "Circle area ∝ {m}" },
  legendGeo: { de: "Fläche = geografische Fläche", en: "Area = geographic area" },
  legendLand: { de: "Farbe = stärkste Partei im Land", en: "Colour = largest party in the state" },
  tip3d: {
    de: "Ziehen zum Verschieben, Rechtsklick/Strg+Ziehen zum Drehen und Kippen, Scrollen zum Zoomen",
    en: "Drag to pan, right-click/Ctrl+drag to rotate and tilt, scroll to zoom",
  },
  webglMissing: { de: "WebGL ist in diesem Browser nicht verfügbar.", en: "WebGL is not available in this browser." },
  theme: { de: "Farbschema", en: "Theme" },
  loading: { de: "Lade amtliche Daten …", en: "Loading official data …" },
} as const;

export type Key = keyof typeof dict;
let lang: Lang = "de";
export const setLang = (l: Lang) => {
  lang = l;
  document.documentElement.lang = l;
};
export const getLang = () => lang;
export const t = (k: Key, vars: Record<string, string> = {}) =>
  dict[k][lang].replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? "");

export const fmt = (n: number) => n.toLocaleString(lang === "de" ? "de-DE" : "en-GB");
export const pct = (n: number, d = 1) =>
  n.toLocaleString(lang === "de" ? "de-DE" : "en-GB", { minimumFractionDigits: d, maximumFractionDigits: d }) + " %";
