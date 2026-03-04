# Character Sprite Assets

Arcane Agents loads character sprites directly from this directory.

## Ownership + License

- Character image assets in this repo are Copyright (c) 2026 Thomas Rice.
- Assets in this repository are included under the MIT license.

## Expected Format

- Frame size: `64x64` PNG per frame.
- Directions: `south`, `east`, `north`, `west`.
- Variable walk frame counts are supported per direction and per character.
- Missing assets fall back to simple Canvas circles/shapes.

## Directory Layout

```text
assets/characters/
  knight/
    rotations/
      south.png
      east.png
      north.png
      west.png
    animations/
      walk/
        south/
          0.png
          1.png
          ...
        east/
          0.png
          1.png
          ...
        north/
          0.png
          1.png
          ...
        west/
          0.png
          1.png
          ...
      working/
        0.png
        1.png
        ...
        15.png
```

Create one top-level folder per character type.

Avatar discovery is directory-driven: Arcane Agents treats each subfolder as an available avatar when these required files exist:

- `rotations/south.png`
- `rotations/east.png`
- `rotations/north.png`
- `rotations/west.png`
- `animations/walk/south/0.png`
- `animations/working/0.png`

If these files are present, you can drop in a new folder and it becomes eligible automatically (including random spawn selection).

## Runtime Behavior

- Idle/static rendering uses `rotations/<direction>.png`.
- Moving characters use `animations/walk/<direction>/<index>.png` frames.
- Working characters use `animations/working/<index>.png` (south-facing loop).
- Frames are loaded in ascending index order starting at `0.png` until a gap is encountered.

## Generation Notes (Recorded)

We do not currently have a checked-in generator preset export or prompt/options log.

What we can reliably recover from the current asset set:

- All character sprites are `64x64` PNG (`402/402` files).
- Direction set is always `south`, `east`, `north`, `west`.
- Walk cycle length is variable by character (legacy packs often `6` frames, newer packs often `8` frames).
- Standard working cycle is `16` frames (`0.png` to `15.png`).
- One known outlier: `rogue` has `12` south walk frames.
- Existing characters share a consistent top-down fantasy RPG style with transparent backgrounds.

Recommended process for future consistency:

1. When generating a new character, copy the exact generation options/prompt into this file.
2. Include model, seed (if available), and any style sliders/toggles.
3. Keep output at `64x64` and preserve the same direction/frame layout.
