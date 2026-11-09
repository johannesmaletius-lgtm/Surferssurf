# Surfers Surf

Endless Runner auf der Welle im weichen Cartoon-Look: ausweichen, springen, durchtauchen, Münzen sammeln.

Spielen: https://johannesmaletius-lgtm.github.io/Surferssurf/

Die Web-App enthält zwei Versionen – im Startbildschirm oben über den Umschalter **2D | 3D** wählen.
Die zuletzt gewählte Version öffnet sich beim nächsten Start wieder (`?2d` erzwingt 2D).
Auf dem Handy über „Zum Home-Bildschirm“ installierbar (`manifest.webmanifest`, `sw.js` lädt immer die neueste
Version und funktioniert auch offline).

## 3D-Version

Echte 3D-Wellen, Licht und Kielwasser mit [Three.js](https://threejs.org/) (MIT-Lizenz):
https://johannesmaletius-lgtm.github.io/Surferssurf/3d/

- `3d/main.js` – das Spiel (Wasser-Shader, Surfer, Inseln, Berge, Delfine, Möwen, Hindernisse)
- `3d/sound.js` – Ton per WebAudio (Meer, Wind, Musik, Effekte), aus dem 2D-Spiel übernommen
- `3d/vendor/three.min.js` – Three.js samt Zusatzmodulen in einer Datei, Lizenz in `3d/vendor/LICENSE-three.txt`
- `3d/tools/vendor-entry.js` – so wird die Vendor-Datei neu gebaut (Anleitung steht oben in der Datei)

Steuerung: Pfeiltasten/WASD oder Wischen – links/rechts ausweichen, hoch springen, runter ducken, Esc pausiert.
Wischen reagiert schon während der Bewegung; ein Sprung kurz vor der Landung wird gemerkt, Ducken in der Luft holt schnell runter.
Hindernisse: Felsen, Treibholz und Schildkröten (springen), Felsbögen und Holzstege (ducken), Seezeichen-Tonnen,
entgegenkommende Motorboote, pendelnde Haie (springen) und Sprungschanzen mit Münzbogen.
Welten: Mittag und Abend (Auswahl im Startbildschirm). Power-ups: Magnet, Schutzblase, Drachen.

Lokal testen: im Projektordner `python3 -m http.server` starten und `http://localhost:8000/3d/` öffnen
(Module laden nicht über `file://`).

## Test-Schalter (2D-Spiel)

- `?nofx` – WebGL-Nachbearbeitung aus
- `?fx` – Nachbearbeitung erzwingen, auch bei Software-Grafik
- `?nosave` – Spielstand wird nicht gespeichert
