# Future Map Rendering Upgrade

This document records the intended long-term solution for high-quality 2D map rendering and future map design upgrades. Use this when the request is to "upgrade map design" or to fix zoom clarity beyond the current local texture approach.

## Current State

The renderer now supports a MapLibre 2D base map with the existing local texture renderer as the automatic fallback. This keeps current simulation functionality intact while allowing crisp online/offline map sources. The 3D globe still uses the local equirectangular textures, because a fully tiled 3D globe requires a separate quadtree/LOD renderer.

The current map styles are intentionally limited to:

- `dark`: local tactical/dim map texture.
- `satellite`: local brighter Earth texture.

Mapbox must use a browser-safe public token only:

```bash
NEXT_PUBLIC_MAPBOX_TOKEN=...
```

Never commit `.env.local` or a Mapbox secret token.

## Why The Previous Tile Attempt Failed

Mapbox and MapLibre web tiles are normally WebMercator tiles. The earlier attempt placed those tiles onto an equirectangular flat map plane. That caused a projection mismatch:

- Map labels and landmasses warped or stretched.
- Tile quality looked broken at zoom.
- 2D satellite, ground station, orbit, and coverage overlays risked geographic misalignment.
- 2D and 3D map design consistency became harder to reason about.

The issue was not only tile quality or token configuration. The deeper issue was rendering WebMercator tiles in the wrong coordinate system.

## Recommended Long-Term Architecture

Use MapLibre GL as the native 2D base map renderer, with a transparent Three.js overlay for simulation entities.

Layer order:

1. MapLibre canvas for the 2D base map.
2. Transparent Three.js or canvas overlay for satellites, ground stations, ground targets, polygons, orbit paths, coverage areas, and communication links.
3. Existing dashboard and controls.

MapLibre should own:

- Base map tile loading.
- WebMercator projection.
- Pan and zoom inertia.
- Retina/high-DPI tile selection.
- Vector labels and symbol placement.
- Tile cache and network scheduling.
- Style JSON support.

The simulation overlay should own:

- Satellite icons and hover/select behavior.
- Ground station and ground target markers.
- Orbit paths.
- Coverage footprints.
- Communication links.
- Create/edit interactions for ground stations, ground targets, and polygons.

## Projection Strategy

Do not manually stretch WebMercator tiles onto a Three.js equirectangular plane.

For 2D mode:

- Use MapLibre's own camera and projection.
- Convert each simulation latitude/longitude into screen coordinates with `map.project([lon, lat])`.
- Render overlay objects in screen-space or in a synchronized orthographic overlay.
- Split orbit and coverage line segments at the antimeridian before projection.
- Reproject overlay geometry on `move`, `zoom`, `resize`, and simulation ticks.

For map clicks:

- Use MapLibre's click event to get exact `lngLat`.
- For create ground station/target, store one `{ lat, lon }`.
- For polygon drawing, append each clicked `{ lat, lon }` to the active polygon.
- For overlay entity picking, check satellite/ground station hit targets first, then fall back to map click behavior.

## Online And Offline Sources

The application must work online and offline. The recommended source strategy is:

Online:

- Mapbox public token through `NEXT_PUBLIC_MAPBOX_TOKEN`, or another MapLibre-compatible hosted style.
- Dark style: vector style is preferred for crisp labels and borders.
- Satellite style: raster imagery with optional vector label overlay.

Offline:

- Prefer PMTiles for local/offline maps.
- Provide MapLibre style JSON files and reference them through:
  - `NEXT_PUBLIC_MAPLIBRE_DARK_STYLE_URL=/maps/dark-style.json`
  - `NEXT_PUBLIC_MAPLIBRE_SATELLITE_STYLE_URL=/maps/satellite-style.json`
- Those style JSON files can reference PMTiles, for example:
  - `pmtiles:///maps/dark.pmtiles`
  - `pmtiles:///maps/satellite.pmtiles`
- Use `pmtiles` protocol integration with MapLibre.
- Fall back to local equirectangular textures only if tile/style initialization fails.

Why PMTiles:

- Single-file distribution is easier than millions of `{z}/{x}/{y}` files.
- Good browser caching behavior.
- Works locally and can also be served from a CDN.
- Supports range requests when hosted properly.

## 2D Implementation Plan

1. Add a MapLibre container below the current simulation overlay. Done.
2. Initialize MapLibre only in 2D mode, or keep it hidden while in 3D mode. Done.
3. Define two style configs: `dark` and `satellite`. Done.
4. Add a source resolver:
   - If a MapLibre style URL is configured, use that first. Done.
   - Else if a public Mapbox token exists, use Mapbox raster styles. Done.
   - If all tile sources fail, fall back to local texture renderer. Done.
5. Move 2D base map pan/zoom responsibility to MapLibre. Done for MapLibre-active mode.
6. Replace current 2D map plane picking with MapLibre `lngLat` events. Done for MapLibre-active mode.
7. Keep overlay picking for satellites, ground stations, and targets. Done.
8. Reproject overlay geometry with `map.project`. Done.
9. Throttle expensive overlay reprojection during fast map movement. Pending if profiling shows need.
10. Preserve existing 3D behavior and state transitions. Done.

## Overlay Performance Rules

Use these rules to keep the upgraded map smooth:

- Reproject visible overlay points only.
- Reuse geometry buffers instead of recreating them every event.
- Use `requestAnimationFrame` batching for `move` and `zoom` events.
- Keep orbit paths simplified based on zoom level.
- Cache projected orbit segments until the map camera or simulation time changes enough to invalidate them.
- Use hit-test buffers for icons instead of large DOM marker sets.
- Keep coverage footprint recalculation throttled; projection can update more often than geodesic recomputation.

## 3D Globe Strategy

Do not block the 2D upgrade on perfect 3D tile parity.

Short-term:

- Keep the current local equirectangular texture on the 3D globe.
- Use the same style names (`dark`, `satellite`) and similar color treatment.

Long-term:

- Implement a globe tile LOD renderer only if deep 3D surface inspection becomes a requirement.
- This requires a quadtree/LOD sphere renderer and is a separate larger phase.

## Visual Acceptance Criteria

The upgrade is acceptable only if:

- 2D zoom stays crisp and does not stretch a single image.
- Pan and zoom feel smooth on normal laptop hardware.
- Dark and satellite styles are visibly different.
- Day/night layer remains visible and does not destroy map readability.
- Satellites, ground stations, targets, orbits, coverage, and links stay aligned with the map at all zoom levels.
- Create/edit clicks return accurate lat/lon values.
- Offline mode still provides a usable map.
- Switching 2D to 3D and 3D to 2D preserves selected/hovered state correctly.

## Anti-Patterns To Avoid

- Do not render WebMercator tiles on an equirectangular plane.
- Do not use a single large image as the final zoom solution.
- Do not rebuild all overlay geometry on every mouse event.
- Do not mix map projections inside the same 2D overlay path.
- Do not reintroduce Mapbox token code unless the renderer is projection-native.
- Do not make Mapbox the only path; offline support is required.

## Trigger Phrase

When future work says "upgrade map design", use this document as the implementation blueprint.
