# Character Sprite Assets

Overworld loads character sprites directly from this directory.

## Expected Format

- Frame size: `128x128` PNG per frame.
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
```

Create one top-level folder per character type. Worker avatar types currently include:

- `knight`
- `mage`
- `ranger`
- `druid`
- `rogue`
- `paladin`
- `orc`
- `dwarf`

Optional overseer sprite type:

- `minotaur`

## Runtime Behavior

- Idle/static rendering uses `rotations/south.png` by default (or the closest available direction).
- Moving characters use `animations/walk/<direction>/<index>.png` frames.
- Frames are loaded in ascending index order starting at `0.png` until a gap is encountered.
