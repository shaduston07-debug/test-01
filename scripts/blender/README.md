# Blender builds for `vendor/models/`

Headless Blender (5.x) scripts that produce the built-in `.glb` models. They read data only
(no add-ons are installed):

- **MakeHuman data** — the `src/mpfb/data` folder of [MPFB2](https://github.com/makehumancommunity/mpfb2) (CC0 assets). Keep its path short on Windows (the target file names are long).
- **Browser dumps** — creature and prop geometry exported from the app's own generators (`cr-<kind>.json/.bin`, `pr-<name>.json/.bin`), so skeletons, joint names and proportions stay exactly the app's. Run `python scripts/blender/serve.py . <dump dir>`, open http://127.0.0.1:8765/scripts/ and in the console `await (await import('/scripts/blender/dump.js')).dumpAll()`.
- **Poly Haven** texture sets (1k `diff`, `nor`, `rough` JPEGs in `<dir>/<id>/`).

```
blender -b --factory-startup --python scripts/blender/build_figures.py   -- <mpfb data> <out>
blender -b --factory-startup --python scripts/blender/build_humanoids.py -- <mpfb data> <dumps> <out> orc ghoul
blender -b --factory-startup --python scripts/blender/build_creatures.py -- <dumps> <out> werewolf demon xeno spider golem kraken dragon
blender -b --factory-startup --python scripts/blender/build_props.py     -- <dumps> <poly haven> <out> car sports moto castle street district w-longsword …
```

`glbwrite.py` writes the glTF binaries, `mhkit.py` reads the MakeHuman data, `bakekit.py` holds
the shared Blender steps (UVs, procedural skins baked to maps, export). Sources and licences:
`vendor/models/CREDITS.md`.
