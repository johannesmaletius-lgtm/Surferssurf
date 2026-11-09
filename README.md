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

- `3d/main.js` – das Spiel (Wasser-Shader, Inseln, Berge, Delfine, Möwen, Hindernisse)
- `3d/models/surfer.glb` (Kai) und `surfer-<figur>.glb` – die Surfer als eigene 3D-Modelle (glTF mit Skelett),
  ansehen und Posen ausprobieren: https://johannesmaletius-lgtm.github.io/Surferssurf/3d/surfer.html (`?f=finn` usw.)
- `3d/surfer.js` – lädt das Modell, Cartoon-Material mit Kontur, Posen auf dem Brett (IK); `3d/rig.js` – das Skelett
- `3d/tools/build-surfer.mjs` – baut die Modelle aus weichen Grundformen; die Figuren stehen dort in `VARIANTS`
  (einmalig `npm i meshoptimizer` in `3d/tools`, dann `node build-surfer.mjs` für alle oder z. B. `node build-surfer.mjs lei`)
- `3d/sound.js` – Ton per WebAudio (Meer, Wind, Musik, Effekte), aus dem 2D-Spiel übernommen
- `3d/vendor/three.min.js` – Three.js samt Zusatzmodulen in einer Datei, Lizenz in `3d/vendor/LICENSE-three.txt`
- `3d/tools/vendor-entry.js` – so wird die Vendor-Datei neu gebaut (Anleitung steht oben in der Datei)

Steuerung: Pfeiltasten/WASD oder Wischen – links/rechts ausweichen, hoch springen, runter ducken, Esc pausiert.
Wischen reagiert schon während der Bewegung; ein Sprung kurz vor der Landung wird gemerkt, Ducken in der Luft holt schnell runter.
Hindernisse: Felsen, Treibholz und Schildkröten (springen), Felsbögen und Holzstege (ducken), Seezeichen-Tonnen,
entgegenkommende Motorboote, pendelnde Haie (springen) und Sprungschanzen mit Münzbogen.
Welten: Mittag und Abend (Auswahl im Startbildschirm). Power-ups: Magnet, Schutzblase, Drachen.

Surfer: Im Startbildschirm (und nach einem Sturz) öffnet **🏄 Surfer** den Shop. Die Figur steht dort groß in der Szene,
mit ‹ › (Pfeiltasten oder Wischen) blättern, kaufen bzw. auswählen. Wie in 2D: Kai (gratis), Leilani (600),
Nalu (1.200), Käpt'n Koko (2.200), Tauchanzug (2.500) und Finn der Hai (3.500). Münzen und gekaufte Figuren teilt
sich die 3D-Version mit der 2D-Version (gleicher Spielstand); die Münzen einer 3D-Runde werden beim Sturz gutgeschrieben.
Modelle werden erst geladen, wenn man sie braucht. `?nosave` schreibt auch in 3D nichts in den Spielstand.
Ein Wisch wechselt genau eine Spur (zurückwischen geht ohne Absetzen).

Flüssig auch auf älteren Geräten: Die Grafik stellt sich selbst ein (Stufe 2 mit Leuchten, 1 ohne, 0 zusätzlich mit
einfacheren Shadern und weniger Partikeln, dazu die Auflösung). Statische Teile sind zu wenigen Zeichenaufrufen
zusammengefasst, Shader werden beim Laden vorbereitet. `?q=0`, `?q=1` oder `?q=2` legt die Stufe fest.

Lokal testen: im Projektordner `python3 -m http.server` starten und `http://localhost:8000/3d/` öffnen
(Module laden nicht über `file://`).

## Test-Schalter (2D-Spiel)

- `?nofx` – WebGL-Nachbearbeitung aus
- `?fx` – Nachbearbeitung erzwingen, auch bei Software-Grafik
- `?nosave` – Spielstand wird nicht gespeichert
