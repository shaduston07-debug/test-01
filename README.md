# Inkwell Studio

A tablet-first painting, animation and webtoon app that runs in the browser. Built for iPad + Apple Pencil, installable to the home screen, works offline. No build step, no server code.

Three modes, picked when you create a canvas:

| Mode | What it is |
|---|---|
| **Illustrate** | Full painting app: layers, blend modes, brushes, smudge, selection, transform, adjustments |
| **Animate** | Multi-track timeline: flipbook drawings per track, keyframed motion, live *performance* capture, onion skin, GIF / video / PNG export |
| **Webtoon** | Long vertical canvas with comic panels, speech balloons, panel-masked layers, smart slicing export and a phone scroll preview |

## Inkwell Learning

A **Studio | Learning** switch sits at the top of the start screen. **Learning** looks like the Studio's start screen: the same **Illustrate / Animate / Webtoon** cards choose a track, and its lessons are shown as picture cards grouped by course: 10 interactive courses and 47 lessons, from your first horizon line to a finished, coloured webtoon episode or animation.

| Track | Courses |
|---|---|
| **Illustration** | Perspective (7 lessons) · Backgrounds & Environments · Expressive Faces · Colouring & Light · Colour Grading |
| **Animation** | Animation 1: Timing & Motion · Animation 2: Character Animation (anticipation, overlap, walk cycle, colouring and export) |
| **Webtoon** | Webtoon 1: Format & Panel Flow · Webtoon 2: Dialogue & Lettering · Webtoon 3: Colouring & Production |

Every lesson has:
- **A live, interactive demo**, drawn in code (no AI-generated pictures, nothing to download): a real 3D perspective lab with movable camera, lens and boxes; a drawing pad that snaps to a 2-point guide; a face rig with the 7 universal expressions (plus a "read the face" quiz); a turnable Loomis head; a lit sphere with light and shadow colours and cel shading; a colour-harmony wheel; a before/after colour-grading lab and a "match the grade" eye-training game; a bouncing ball with timing, squash & stretch and a spacing chart; an editable timing chart; arcs, anticipation, overlapping action, ones-vs-twos and a step-through walk cycle; a phone that scrolls a webtoon with adjustable gutters; a balloon-order exercise that checks reading order and crossed tails; panel-safe slicing; and the colouring pipeline step by step.
- **A short quiz** (answering everything marks the lesson complete), a **Remember** box, and the **sources** the lesson follows.
- **Guided exercises**: each challenge is 4 exercises in a real canvas: **1 Trace it** (every line is drawn for you in blue on a locked *Guide (help)* layer that never shows in exports), **2 Half help**, **3 Start only** and **4 On your own**. A floating window explains each one and moves you to the next; each exercise gets its own layer, so you can compare them. Closing the canvas brings you back to the lesson. The head, expression, model-sheet, colouring and grading exercises use real drawings instead of drawn guides, in the classic academy order (trace → finish the other half → look & copy beside it → from memory): Pepper's official head turnaround and model sheet, Saffron's expression line art and construction sketch (Pepper&Carrot by David Revoy, CC BY 4.0), Charles Le Brun's expression heads (CC0), and Revoy's paintings to grade. Perspective, animation and webtoon exercises use exact constructions (vanishing-point geometry, spacing charts, Richard Williams' walk positions, panel layouts). Each course ends with a **final project** that you apply to your own ideas.

Progress (lessons, quizzes, challenges, where you left off) is saved on the device. Every canvas made from Learning (exercises and final projects) is kept in **Learning › 🗂 My drafts**, grouped into Illustrate / Animate / Webtoon, apart from your own artwork in the Studio gallery. Tap one to keep working (closing it brings you back to My drafts); ⋯ renames, duplicates, exports, deletes or moves it to the Studio gallery.

**Real artwork to study.** 31 lessons include a "Study real artwork" gallery of human-made art with notes on what to look at (tap a picture to see it full screen): Caillebotte's *Paris Street; Rainy Day* for the horizon and 2-point perspective, the Urbino *Ideal City* for 1-point, Piranesi's *Imaginary Prisons*, Friedrich, Hokusai and Bierstadt for composition and atmosphere, Charles Le Brun's expression heads for the universal expressions, Monet's Rouen Cathedral series for light and colour grading, Muybridge's *Horse in Motion* for timing, and David Revoy's Pepper&Carrot (model sheets, expression studies, value and colour studies, and comic pages before and after lettering). The pictures are public domain / CC0 (Wikimedia Commons, The Met open access) or CC BY 4.0 (Pepper&Carrot, credit: David Revoy, www.peppercarrot.com). They live in `art/learn/`; every credit is shown under the picture and in Learning › Artwork credits (`art/credits*.json`, built into `js/learn/art.js` by `scripts/build-art-credits.py`).

The interactive face is an illustrated, layered portrait (shaded skin, layered hair, detailed eyes) driven by the expression sliders; the colouring-pipeline demo builds the same portrait up layer by layer, from sketch to colour grade.

**Sources.** The lessons follow established, human-made teaching material: Andrew Loomis, Scott Robertson's *How to Draw*, Drawabox, Ctrl+Paint, James Gurney's *Color and Light*, Marco Bucci, Paul Ekman's research and Gary Faigin's guide to facial expression, Thomas & Johnston's *The Illusion of Life*, Richard Williams' *The Animator's Survival Kit*, Alan Becker's 12-principles series, Scott McCloud, Blambot's lettering conventions, WEBTOON's own Creator's Resource Handbook and Before You Publish checklist, and Clip Studio's tutorial site. Free assets the courses recommend are CC0 or CC-BY: Kenney, Quaternius, Poly Haven, Blender, Blender Studio's open movies, the Morevna Project and Pepper&Carrot.

## Perspective tool

The fan icon in the Studio's top bar (or **R**, or Actions › Canvas › Drawing guide · Perspective) adds a perspective ruler to the canvas:
- A short bar: **1-point / 2-point / 3-point**, **Snap: on/off**, **Hide/Show**, **More…** (number of lines, line strength, square grid, See all points, Remove), **?** (the 3-step intro, also shown the first time) and **Done ✓**.
- Drag the round handles: the orange **Eye level** handle moves the horizon, the coloured **Point** handles are the vanishing points. Moving Point 1 or 2 keeps the horizon level; hold a finger on the screen while dragging to tilt it.
- With Snap on, every brush or eraser stroke follows the guide direction closest to the way it starts. Lift the pen to change direction; hold a finger on the screen while drawing to draw freely.
- The guide is saved with the canvas.

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

**Easiest with SideStore / AltStore (no Safari download):** in SideStore open **Sources › ＋** and add `https://raw.githubusercontent.com/shaduston07-debug/test-01/download/sidestore.json`. Inkwell Studio then appears under **Browse**; install it there, and every new build shows up under **My Apps › Updates**. Each build has its own version number (1.0.<build>).

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

**3D layers** (Clip Studio-style):
- **Drawing figures**: realistic female and male bodies built on the MakeHuman base mesh (CC0, makehumancommunity.org). They are rigged with the app's skeleton and skinned automatically, so the surface bends smoothly at every joint. Optional **guide lines** (face and body centre line, eye line) help with drawing, like Clip Studio's figures; turn them off in *Body…*. If that mesh can't load, a sculpted body (about 120 anatomical forms) is used instead. There are ~60 joints, including the clavicles, spine, neck and every finger. *Body…* sets the sex, height, head-to-body ratio and build.
- **Armour**: *Body…* can add fitted **medieval plate** or **sci-fi** armour. The plates are grown from the body's own surface and bend with it.
- **Posing**: in *Pose* mode, tap a body part and drag to bend it. Dragging a hand or foot moves the whole limb (**IK**, toggle it off with the *IK* button). *Mirror* swaps left and right.
- **Poses…**: 44 built-in poses (standing, action and dynamic, sitting and floor, expressive, riding, driving). *Hands…* gives 8 hand shapes.
- **BVH…**: import poses from BVH motion files (Mixamo, CMU, Daz and VRM skeletons, with a frame slider) and export the current pose as BVH. BVH is the pose format Clip Studio Paint 3.1+ imports.
- **＋ Library…**
  - **Creatures** (each one sculpted, posable and with its own poses): dragon, werewolf, orc brute, winged demon, ghoul, alien, giant spider, stone golem, kraken.
  - **Weapons**: longsword, katana, dagger, battle axe, war hammer, spear, kite and round shields, longbow, pistol, assault rifle, plasma rifle, energy sword. They go straight into a figure's hand (shields on the forearm) and follow every pose. *Hold…* switches hands or drops the weapon.
  - **Vehicles**: sedan, sports car, motorcycle.
  - **Places**: castle, city street, city district, cyberpunk street, ruined city, mountains & lake, forest hills, desert dunes.
- **Camera…**: front, three-quarter, side, back, high, low, dramatic and top-down presets.
- **Imported models**: glTF/GLB/VRM, FBX and OBJ, the open formats Clip Studio Paint imports. Clip Studio's own files (`.cs3c`, `.cs3o`, `.cs3s`, `.cmo`, …) are closed formats. They are searched for an embedded FBX, glTF or OBJ (including inside zip or SQLite containers), so only some of them load.
- **Also**: primitive shapes, orbit / pan / zoom camera, move / rotate / scale, lighting and outlines. *Rasterize* turns the layer into pixels so you can draw over it.
- three.js loads only when a 3D layer is used. Bodies are meshed in background workers (about 1–2 s, then cached), so the app stays responsive.

PoseManiacs' direct link is a private Clip Studio feature. Poses come in through BVH files instead.

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

**Pressure is a bonus**: every brush is tuned to look right at full strength. Auto only uses pressure once your pen shows it really senses it (Apple Pencil); pens without a sensor (Apple Pencil USB-C, Logitech Crayon, most other styluses) draw at full strength. Light pressure can thin / lighten a stroke but never make it vanish (≥ 35 % size, ≥ 50 % opacity). Optional extras in Settings › Pen pressure from: Tilt or Speed.

**Brush save points**: the bookmark button under the sliders saves the current size + opacity for each brush; tap a point to jump back to it, hold to delete.

**Automatic backups** (Gallery › Backup): the iPad app backs everything up on its own after you work (at most every 10 minutes, after closing a canvas), keeping the last 5 full backups in **Files › On My iPad › Inkwell Studio › Backups**, with *Restore an automatic backup…* to bring one back. These live in the app's folder, so iOS deletes them together with the app. **Cloud backup** survives that: connect a private GitHub repository (fine-grained key with Contents: Read and write, stored only on the device and never put in backup files) and every canvas you change is uploaded as its own small backup file, and your brushes (including scanned ibis Paint brushes), fonts, palettes and settings go in a separate library file whenever they change; *Restore from cloud…* brings them all back on a fresh install. Safari / Home Screen versions, which can't write files on their own, get a weekly reminder instead.

**Backup & Restore** (Gallery › Backup): one `.inkwellbackup` file with every canvas, brush, font, palette and setting (time-lapses optional). Updating the iPad app: install the new .ipa over the old one without deleting it and everything stays; the backup is the safety net.

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
- No vector line editing. Perspective rulers are straight-line (1/2/3-point); there are no curvilinear (fisheye) rulers.
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
js/perspective.js           Perspective ruler: guide, handles, stroke snapping
js/learn/learn.js           Inkwell Learning: tabs, course / lesson screens, quizzes, progress, challenges
js/learn/courses.js         Course and lesson content with sources
js/learn/demos.js           Interactive lesson demos (canvas / SVG)
js/importers.js             .sut / .brush / .brushset / image brush import
js/gif.js                   GIF encoder
js/storage.js, sw.js        IndexedDB persistence, offline cache
js/platform.js              Native app / Home Screen glue (Files + share sheet export, iOS file picker)
ios/                        Native iPad app (Capacitor Xcode project)
scripts/build-www.mjs       Copies the web app into www/ for the native build
vendor/                     sql.js (SQLite → wasm), JSZip
```
