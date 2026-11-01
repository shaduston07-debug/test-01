# Built-in 3D models — sources and licences

All files here were made in Blender (headless) with the scripts in `scripts/blender/`
(see the header of each script for the exact command). Every source is CC0 (public domain).
If a file is missing or fails to load, the app builds the older generated model instead.

## Sources

| Source | Licence | Used for |
| --- | --- | --- |
| MakeHuman `hm08` base mesh, macro targets (gender, muscle, weight, proportions) and detail targets (face, ears, limbs, hands), Mixamo-compatible rig and its weights, the default rig's jaw weights — from the data folder of [MPFB2 v2.0.18](https://github.com/makehumancommunity/mpfb2) (`src/mpfb/data`, see its `LICENSE.ASSETS.md`) | CC0 1.0 | figures, orc, ghoul |
| Inkwell Studio's own generated models (`js/creatures.js`, `js/models3d.js`, `js/world3d.js`) | this project | shapes of the other creatures, vehicles, castle, city, weapons |
| [Poly Haven](https://polyhaven.com) textures (1k): [castle_wall_slates](https://polyhaven.com/a/castle_wall_slates), [grey_roof_tiles](https://polyhaven.com/a/grey_roof_tiles), [medieval_wood](https://polyhaven.com/a/medieval_wood), [leafy_grass](https://polyhaven.com/a/leafy_grass), [asphalt_02](https://polyhaven.com/a/asphalt_02), [square_brick_paving](https://polyhaven.com/a/square_brick_paving), [concrete](https://polyhaven.com/a/concrete), [grey_plaster](https://polyhaven.com/a/grey_plaster), [brown_leather](https://polyhaven.com/a/brown_leather), [fine_grained_wood](https://polyhaven.com/a/fine_grained_wood) | CC0 1.0 | castle, city, vehicles, weapons |

The creature skins (fur, scales, leather, chitin, rock, wet skin) are procedural Blender
materials and displacement, baked to texture maps; no external images are used for them.

## Files

| File | Made from |
| --- | --- |
| `figure-female.glb`, `figure-male.glb` | MakeHuman body shaped with its own targets, subdivided once, ambient occlusion baked into vertex colours, Mixamo-compatible weights merged onto the app's joints; morph targets *slim* / *strong* for Build |
| `creature-orc.glb`, `creature-ghoul.glb` | MakeHuman body with creature targets (jaw, brow, ears, limbs, gaunt / heavy build), eyes, tusks / claws, procedural skin baked to maps; bound in its A-pose with per-joint bind rotations |
| `creature-werewolf.glb`, `-demon`, `-xeno`, `-spider`, `-golem`, `-kraken`, `-dragon` | Inkwell's sculpted creature (same skeleton and joint names), smoothed, decimated, UV-unwrapped; displaced high-resolution copy with a procedural skin baked to albedo / normal / roughness / AO |
| `car.glb`, `sports.glb`, `moto.glb` | Inkwell's generated vehicles: welded and bevelled, clear-coated paint (tinted with the object colour in the app), chrome, rubber, glass, lights |
| `castle.glb` | Inkwell's generated castle with Poly Haven stone, slate roof, wood and grass |
| `street.glb`, `district.glb` | Inkwell's generated city: Poly Haven asphalt (with lane markings), paving, concrete; facade atlas composited from Poly Haven plaster with framed, partly lit windows |
| `w-*.glb` (13 weapons) | Inkwell's sculpted weapons with steel, gold, Poly Haven leather and wood |
