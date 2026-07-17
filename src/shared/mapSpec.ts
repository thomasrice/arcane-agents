/**
 * Shared schema and constants for the outpost map artefact (`assets/maps/outpost.json`).
 *
 * The same file is consumed independently by two sides:
 *  - the server spawn planner (`src/server/orchestrator/spawn`) reads it from disk to
 *    place newly spawned workers on the map;
 *  - the client map loader (`src/client/map/tileMapLoader`) fetches it over HTTP
 *    (`/api/assets/maps/outpost.json`) to size and label the rendered map.
 *
 * Both previously hand-rolled their own types for this one file. This module is the
 * single source of truth for its raw shape and the constants derived from it. Each side
 * keeps its own loaded/normalised types; only the raw-file shape and shared constants
 * are unified here.
 *
 * The separate `outpost.logic.json` artefact (collision/occlusion/flame grids) is parsed
 * only by the client and is intentionally not modelled here.
 */

/** Spawn-area rectangle in map-tile coordinates (inclusive corners), as stored in the file. */
export interface OutpostSpawnArea {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Raw shape of `outpost.json` as stored on disk and served at
 * `/api/assets/maps/outpost.json`. Fields are typed as they appear in the file; the file
 * carries additional presentation data (terrain, zones, objects) that neither consumer
 * reads, so it is not modelled. Consumers validate/normalise as needed — the server
 * tolerates a missing or malformed `width`/`height`, so it parses against `Partial<>` of
 * this shape.
 */
export interface RawOutpostMap {
  name: string;
  width: number;
  height: number;
  tileSize: number;
  spawnArea?: OutpostSpawnArea;
}

/**
 * Fallback world-pixel centre used by the spawn planner when the map spec is unavailable
 * or defines no spawn area. It is not derivable from the map: it is used precisely on the
 * paths where the map dimensions may be unknown (missing/unparseable spec), so it is an
 * explicit named constant rather than a value computed from the map. Value preserved from
 * the previously hardcoded literals in `spawnPosition.ts`.
 */
export const fallbackSpawnCenter = { x: 520, y: 310 } as const;
