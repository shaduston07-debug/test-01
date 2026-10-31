# Inkwell Studio

A tablet-first painting, animation and webtoon app that runs in the browser. Built for iPad + Apple Pencil, installable to the home screen, works offline. No build step, no server code.

Three modes, picked when you create a canvas:

| Mode | What it is |
|---|---|
| **Illustrate** | Full painting app: layers, blend modes, brushes, smudge, selection, transform, adjustments |
| **Animate** | Multi-track timeline: flipbook drawings per track, keyframed motion, live *performance* capture, onion skin, GIF / video / PNG export |
| **Webtoon** | Long vertical canvas with comic panels, speech balloons, panel-masked layers, smart slicing export and a phone scroll preview |

## Installing on iPad

There are two ways to get it onto an iPad. The native app is the better one.

### A. Native iPad app (recommended)

`ios/` is a ready-made Xcode project (Capacitor 8, Swift Package Manager, no CocoaPods). It's iPad-only, supports every orientation and Split View, hides the status bar, and has its own icon and launch screen. Exports go to **Files › On My iPad › Inkwell Studio › Exports** and open the share sheet (Save Image, AirDrop, …).

**With a Mac (Xcode 16+):**

```sh
npm install
npm run ios          # copies the web app into the project and opens Xcode
```

In Xcode: select the **App** target → *Signing & Capabilities* → choose your Team. A free Apple ID works, but the app expires after 7 days. A $99/yr developer account lasts a year and can publish to TestFlight or the App Store. Plug in the iPad and press ▶.

**Without a Mac:** the **iPad app** GitHub Action (`.github/workflows/ios.yml`) builds an unsigned `InkwellStudio.ipa` on a GitHub macOS runner on every push, or on demand from *Actions › iPad app › Run workflow*. Download it from the repo's **Releases** section ("Inkwell Studio for iPad (latest build)") or the `download` branch and install it with **Sideloadly** (Windows/Mac) or **AltStore**. Both re-sign it with your Apple ID (7-day expiry on free accounts; AltStore can auto-refresh).

After changing the web code, run `npm run sync` to copy it into the iOS project.

### B. Home Screen web app

Host the folder over HTTPS, open it in Safari, then *Share → Add to Home Screen*. It launches full-screen, and the service worker caches everything for offline use.

- **Live at https://shaduston07-debug.github.io/test-01/**: `.github/workflows/pages.yml` rebuilds the `gh-pages` branch on every push.
- **Free alternatives:** run `npm run build`, then drag the `www/` folder onto Netlify Drop (app.netlify.com/drop) or Cloudflare Pages.

Artwork is stored on-device (IndexedDB) and can be organised into **folders** (Procreate-style stacks): tap ＋ Folder, drag a canvas onto a folder or onto another canvas, or use ⋯ › Move to folder. Export `.inkwell` project files for backups. In Safari the Home Screen version and the browser version keep **separate** storage.

### Local development

```sh
python3 -m http.server 8000      # then open http://localhost:8000
```

## Features

**Drawing engine**
- Stamp-based brushes: pressure → size / opacity / flow, tilt shading, StreamLine stabilizer, taper, scatter, jitter, follow-direction, roundness
- Canvas-anchored grain textures (paper, canvas, grit, halftone, crosshatch, or your own image)
- 29 built-in brushes in Sketching, Inking (including a CSP-style G-Pen), Painting, Airbrush, and Comic & Tone (halftone, crosshatch, speed lines)
- **Brush Studio**: edit every parameter with a live Apple Pencil test pad; save copies; built-ins can be edited and reset
- Smudge and eraser can use any brush
- **QuickShape**: hold at the end of a stroke to snap to a line, arc or ellipse, then keep dragging to adjust. A finger on the screen snaps angles or makes a perfect circle
- Symmetry guides: vertical, horizontal, quadrant, radial

**Brush import**
- **Clip Studio Paint `.sut`**: read as SQLite. Maps size, opacity, density, hardness, spacing, thickness, rotation, stabilization, pressure and spray. Tip and texture PNGs are pulled out of `MaterialFile` blobs
- **Procreate `.brush` / `.brushset`**: unzips Shape/Grain PNGs and reads `Brush.archive` (binary plist / NSKeyedArchiver) for name, spacing, jitter, StreamLine and pressure settings
- **PNG / JPG**: any image as a tip

**ibis Paint brushes**
- Brush Library › **ibis Paint** › *Scan QR image*: pick the QR code exported from ibis Paint (Brush window › menu › Export Brush QR Code), or a screenshot of one
- The QR is decoded in the app (jsQR). ibis Paint brush codes are binary **IPBZ** records (`IPBZ` · version · raw-deflate): they're decompressed and thickness, opacity, interval, pressure, speed and start-taper are applied. The format isn't published, so the field mapping was worked out from real codes; other codes fall back to reading any recognisable settings, and an editor that uses ibis Paint's own setting names (Thickness, Opacity, Interval, Start thickness, pressure / speed / random, Angle, Stabilizer, Anti-aliasing, brush image). The raw code is kept with the brush
- ibis-style starter brushes (Dip Pen, Felt Tip, Fude, Pencil, Airbrush, Watercolor, Glow) and **speed dynamics** in the engine: faster strokes get thinner and/or lighter

**Layers** (Procreate-style, plus CSP extras): hold and drag to reorder, **groups** (collapse, hide, opacity, flatten; drop a layer onto a group to put it inside), and options in a scrollable side sheet next to the panel
- 17 blend modes, opacity, alpha lock, clipping masks, merge, duplicate, reorder, fill, clear, select-from-alpha
- **Reference layer** (from CSP): the fill tool reads boundaries from it, so you can fill colors on a separate layer under your line art
- A layer limit based on canvas size, so Safari doesn't run out of memory

**Tools**
- Fill with tolerance, **gap closing** and **expand** (CSP-style), reading from this layer / all layers / reference layers
- **ColorDrop**: drag the color dot onto the canvas
- Selection: **Automatic** (magic wand; slide left/right to change the threshold), **Freehand** lasso (drag, or tap to place polygon points and tap the start dot to close), Rectangle, Ellipse; New / Add / Subtract / Intersect; feather, save & load, invert, copy & paste, cut & paste, color fill, clear
- Transform: uniform or freeform, flip, rotate, fit
- Adjustments with live preview: HSB, color balance, levels, blur, sharpen, noise, posterize, threshold, gradient map, *brightness → opacity* (clean up scanned line art), *change line color*

**3D layers**: a posable drawing figure (tap a body part in *Pose* and drag to bend it, plus presets), imported **glTF/GLB/VRM, FBX and OBJ** models (the open formats Clip Studio Paint imports). Clip Studio files (`.cs3c`, `.cs3o`, `.cs3s`, `.cmo`, …) are searched for an embedded FBX / glTF / OBJ (including inside zip or SQLite containers) and loaded when one is found; CSP's own formats are closed, so this works only for some files, primitive shapes, orbit / pan / zoom camera, move / rotate / scale, lighting and outlines, then *Rasterize* to draw over it. three.js loads only when a 3D layer is used.

**Animation (Dreams-style)**
- Tracks of flipbook drawings. Retime by dragging blocks; hold ±, duplicate, delete
- Per-track motion keyframes (position / scale / rotation / opacity; smooth, linear or hold)
- **Perform**: arm ●, press play, and drag the canvas with the Move tool; the motion is recorded live
- Onion skin (frames before and after, colors, opacity); loop / ping-pong / once
- Export animated GIF (built-in encoder), MP4/WebM video (MediaRecorder), or a PNG frame ZIP

**Webtoon (CSP-style)**
- Panel tool: draw, move, resize, split horizontally or vertically; auto layout with gutters and margins; border width and color
- Raster layers can be **masked to panels**, so art never spills into the gutters
- Balloon tool: speech, thought, shout, box, text/SFX; draggable tails; fonts, colors, sizes
- Extend the canvas downward; slice guides; **smart slicing** export that avoids cutting through panels; phone scroll preview

**Color**: hue ring with an SV triangle, classic square, RGB/hex values, palettes and history, plus Hue / Saturation / Brightness bars under every mode

**Floating windows**: pin the Color, Layers or Brush panels to keep them open while painting; drag them by the title bar

**Text & speech bubbles** (Illustrate and Webtoon): Actions › Add › *Add text* / *Add speech bubble*, or the bubble tool. Speech, thought, shout, box and plain text; 14 built-in fonts including Japanese manga gothic/mincho, plus **import your own fonts** (TTF / OTF / WOFF); alignment, line spacing, bold / italic, **vertical (manga) text**, letter outlines; Rasterize to paint over it.

**Brush sets**: 🕘 Recent and ★ Favorites at the top of the Brush Library, plus your own sets (＋ New set; hold a brush for *Add to set…*; hold a set to rename / delete).

**Gradient Map**: 20 presets (Noir, Sepia, Golden Hour, Sunset, Ocean, Neon City, …) and a stop editor (add / move / recolor stops, reverse); runs on the worker pool.

**Photos & video**: Insert a photo, Insert a *private* photo (never shown in the time-lapse — any layer can be marked Private), Insert a video frame (scrub to the frame), Import video as animation drawings (Animate).

**ibis Paint brushes included**: Pluma falcon suave (difuminado), Ink Pen and Rough Layout Pen (Blurring), decoded from their QR codes. Scanning reads thickness, opacity, interval, pressure, speed, start taper, minimum thickness, textured material and blurred edges.

**Color palettes**: as many palettes as you like — create blank, from recent colors, from a photo, or import Procreate .swatches, Photoshop .aco / .ase, GIMP .gpl and hex lists; rename, duplicate, delete, share as .swatches. The default palette also shows under the Triangle, Classic and Value modes.

**Steady ink** (on by default, Actions › Prefs): pens and markers always lay down solid ink — pressure and speed never fade them, a light touch still gives a clean line (30–45% of full width minimum), pressure follows a soft curve and only changes the width gently, and edges stay crisp. Pencils, chalk, airbrushes and paint brushes keep their own pressure behaviour.

**Styluses without pressure** (Apple Pencil USB-C, Logitech Crayon, most other pens): detected automatically after a couple of strokes — tilt then sets the line width (lean = thicker). Settings › Pen pressure from: Auto, Pencil pressure, Tilt, Speed or Off.

**Rapid undo / redo**: hold two fingers on the canvas to keep undoing, three to keep redoing (or hold the undo / redo buttons) — it starts after a short delay (adjustable, like Procreate's Rapid Undo Delay) and speeds up from 15 to 120 steps a second, with a step counter. Up to 250 undo steps.

**Reference window**: Actions › Canvas › Reference toggles a floating, resizable companion window — *Canvas* shows a live overview of the whole artwork, *Image* shows a reference picture you import. Pinch / scroll to zoom, drag to pan, double-tap to reset, touch and hold to pick a colour.

**Brush cursor**: outline of the brush size while the Apple Pencil hovers and while painting (sized by your pressure); both switch on/off in Actions › Prefs.

**Time-lapse**: every change is captured in the background (720p / 1080p / 2K) and stored per canvas; Actions › Video › Time-lapse Replay, and export Full length or 30 seconds as MP4 (WebCodecs H.264).

**Share** (Procreate's list): Share Image — Inkwell, **PSD** (layers, names, opacity, blend modes, visibility, clipping, alpha lock; RLE), **PDF**, JPEG, PNG, **TIFF**; Share Layers — PDF (page per layer), PNG files, Animated GIF, **Animated PNG**, **Animated MP4**, **Animated HEVC** (where the device supports it); Time-lapse video.

**Multi-core**: a worker pool sized to the CPU (up to 8 workers on an M4) runs adjustments in parallel bands, flood fill and Automatic selection off the main thread, autosave PNG encoding with OffscreenCanvas (all layers at once) and GIF encoding.

**Performance**: layers below and above the one being painted are cached, so a frame is about 3 image draws. Undo uses GPU canvas copies (no pixel readbacks), the paper shadow has no per-frame blur, webtoon panel masks use clip paths, and autosave only re-encodes changed layers

**Tablet ergonomics**
- Two-finger tap = undo (hold the undo button to rewind fast), three-finger tap = redo, four-finger tap = hide UI
- Pinch / rotate / pan with right-angle snapping; a quick pinch fits the canvas
- Palm rejection: once an Apple Pencil is detected, fingers only navigate. Touch-and-hold = eyedropper
- Pencil hover brush cursor, coalesced high-rate Pencil events, adjustable pressure curve
- Large touch targets, safe-area aware, left- or right-handed sidebar
- Keyboard shortcuts (B / E / S / V / G / I, `[` `]`, ⌘Z, space-pan, …) for Magic Keyboard

## Limits

- CSP `.sut` and Procreate archives are undocumented formats, so import is best-effort. Shapes, textures and the main dynamics come across; exact pressure curves, dual brushes and color dynamics don't.
- Photoshop `.abr` isn't supported (import the tip as a PNG instead). No PSD export (layers export as a PNG ZIP).
- No 3D models, perspective rulers or vector line editing.
- Safari limits each canvas to about 16.7 megapixels and caps total canvas memory. Very long webtoons should be split into several episode files.

## Code layout

```
index.html, css/app.css     UI shell
js/main.js                  App: view, input & gestures, tools, render loop, autosave
js/engine.js                Stroke engine (stamping, dynamics, grain, symmetry, smudge, QuickShape)
js/brushes.js               Built-in brushes, procedural tips & grains
js/doc.js                   Document model, compositor, balloons, serialization
js/tools.js                 Flood fill, selection, transform, adjustments
js/ui.js                    Panels: brushes, Brush Studio, layers, color, actions, gallery
js/anim.js                  Timeline, playback, performance capture, export
js/webtoon.js               Panels, balloons, slicing, preview
js/importers.js             .sut / .brush / .brushset / image brush import
js/gif.js                   GIF encoder
js/storage.js, sw.js        IndexedDB persistence, offline cache
js/platform.js              Native app / Home Screen glue (Files + share sheet export, iOS file picker)
ios/                        Native iPad app (Capacitor Xcode project)
scripts/build-www.mjs       Copies the web app into www/ for the native build
vendor/                     sql.js (SQLite → wasm), JSZip
```
