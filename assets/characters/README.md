# Character Sprite Assets

Overworld loads character sprites directly from this directory.

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

Create one top-level folder per character type. Worker avatar types currently include:

- `knight`
- `wizard`
- `enchantress`
- `berserker`
- `druid`
- `rogue`
- `priestess`
- `elf-ranger`
- `minotaur`

## Runtime Behavior

- Idle/static rendering uses `rotations/<direction>.png`.
- Moving characters use `animations/walk/<direction>/<index>.png` frames.
- Working characters use `animations/working/<index>.png` (south-facing loop).
- Frames are loaded in ascending index order starting at `0.png` until a gap is encountered.
