# Surfers Surf

Endless Runner auf der Welle im weichen Cartoon-Look: ausweichen, springen, durchtauchen, Münzen sammeln.

Spielen: https://johannesmaletius-lgtm.github.io/Surferssurf/

## 3D-Prototyp

Echte 3D-Wellen, Licht und Kielwasser mit [Three.js](https://threejs.org/) (MIT-Lizenz):
https://johannesmaletius-lgtm.github.io/Surferssurf/3d/

- `3d/main.js` – das Spiel (Wasser-Shader, Surfer, Inseln, Hindernisse)
- `3d/vendor/three.min.js` – Three.js samt Zusatzmodulen in einer Datei, Lizenz in `3d/vendor/LICENSE-three.txt`
- `3d/tools/vendor-entry.js` – so wird die Vendor-Datei neu gebaut (Anleitung steht oben in der Datei)

Lokal testen: im Projektordner `python3 -m http.server` starten und `http://localhost:8000/3d/` öffnen
(Module laden nicht über `file://`).

## Test-Schalter (2D-Spiel)

- `?nofx` – WebGL-Nachbearbeitung aus
- `?fx` – Nachbearbeitung erzwingen, auch bei Software-Grafik
- `?nosave` – Spielstand wird nicht gespeichert
