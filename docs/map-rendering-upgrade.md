# Map Rendering Architecture

This document records the current map rendering design and the next safe upgrade path. Use it whenever the request is to improve map visual quality, tile performance, offline maps, or 2D/3D map consistency.

## Goals

- Keep 2D and 3D visual styles consistent.
- Support both online and offline deployments.
- Keep pan, zoom, simulation playback, hover, selection, coverage, links, and AOI editing aligned and responsive.
- Avoid stretching map imagery in the wrong projection.
- Keep only two public map presets: `dark` and `light`.

`light` is the public prop name for the satellite-style map. Internally the simulation still uses the existing `satellite` map type in a few store paths.

## Public Configuration

`OriginalSimulation` controls the map through these props:

```tsx
<OriginalSimulation
    onlineMap={true}
    editMode={false}
    mapType="light"
    viewType="3D"
/>
```

| Prop | Meaning |
| --- | --- |
| `onlineMap` | `true` uses Mapbox/MapLibre tile sources. `false` uses bundled local textures. |
| `editMode` | Starts a 2D create/edit workspace. Edit mode forces the dark editing map and disables inspect-only overlays. |
| `mapType` | Public map preset: `dark` or `light`. |
| `viewType` | Initial view: `2D` or `3D`. Edit mode always starts in 2D. |

## Online Rendering

Online mode uses projection-native tile rendering in both views.

2D:

- `MapLibreBaseLayer` owns the base map.
- MapLibre handles tile loading, projection, labels, pan, zoom, high-DPI tile selection, and style JSON behavior.
- `FlatMapLayer` renders satellites, ground stations, ground targets, AOIs, paths, coverage, and links as a synchronized Three.js overlay.
- Overlay coordinates are projected from geographic coordinates through the active MapLibre transform.

3D:

- `TiledGlobeLayer` renders online raster tiles onto globe segments.
- The globe tile layer is clipped by the actual globe surface, so back-side entities are not visible through Earth.
- `EarthScene` keeps day/night and environmental data layers separate from the base tile renderer.

Supported online sources:

- `NEXT_PUBLIC_MAPLIBRE_DARK_STYLE_URL`
- `NEXT_PUBLIC_MAPLIBRE_SATELLITE_STYLE_URL`
- `NEXT_PUBLIC_MAPBOX_TOKEN` as the hosted Mapbox fallback source

Only browser-safe public Mapbox tokens should use the `NEXT_PUBLIC_` prefix. Never commit `.env.local`.

## Offline Rendering

Offline mode uses local equirectangular textures from `public/textures` in both 2D and 3D.

Expected texture roles:

- `earth-dark.png`: dark day-side base map.
- `earth-light.jpg`: light day-side base map.
- `earth-night.jpg`: night-side city-lights/low-light base map.

Offline day/night behavior:

- Day side uses the selected `dark` or `light` texture.
- Night side blends to `earth-night.jpg` with a smooth sun terminator.
- Offline light mode does not receive an extra day-side dark tint.
- Offline dark mode keeps its tactical color grading on the day side only.

This means the old "black overlay over the whole map" approach should not be reintroduced for offline light maps.

## Projection Rules

Do not manually stretch WebMercator tiles onto a Three.js equirectangular plane. That was the root cause of earlier blurry, warped, and misaligned map attempts.

For 2D MapLibre mode:

- Use MapLibre's own camera and projection.
- Convert every simulation lat/lon to screen coordinates through the map projection bridge.
- Reproject overlay geometry on map `move`, `zoom`, `resize`, and simulation ticks.
- Split paths at the antimeridian when needed so lines do not cross the whole screen.

For map clicks:

- MapLibre click/pointer events provide exact `lngLat`.
- Ground station and ground target creation stores one `{ lat, lon }`.
- AOI creation stores a unique point list and requires at least three points before commit.
- Entity picking should test simulation overlays first, then fall back to map creation behavior.

## Edit Mode Rules

Edit mode is intentionally a clean scratchpad.

- Force the dark map style for editing clarity.
- Disable day/night layers and environmental overlays.
- Hide inspect-only data such as satellite coverage, GSN coverage, comm links, and unrelated objects.
- For create mode, show only the active draft object.
- For edit mode, show only the object being edited.
- AOI vertices are visible only while creating or editing AOIs in 2D. Inspect mode shows AOI fill and outline without vertex handles.
- Switching to 3D exits create/edit mode and discards invalid AOI drafts with fewer than three unique points.

## Performance Rules

- Keep MapLibre responsible for tile movement and inertia.
- Reuse Three.js materials and geometry buffers where practical.
- Keep overlay reprojection tied to a map transform revision so coverage, links, and icons stay aligned during pan/zoom.
- Recompute expensive geodesic coverage and communication geometry less often than cheap screen-space reprojection.
- Batch satellite rendering instead of creating one independent mesh per satellite.
- Avoid DOM markers for large entity sets; use WebGL overlays and compact hit-test buffers.
- Do not rebuild all orbit/coverage geometry on every pointer event.

## Visual Acceptance Criteria

The map renderer is acceptable only if:

- 2D and 3D use matching dark/light visual intent.
- Online 2D zoom remains crisp and projection-correct.
- Online 3D globe shows actual map tiles, not a transparent or textureless globe.
- Offline 2D and 3D remain usable without network access.
- Day/night is clearly visible when enabled and absent in edit mode.
- Satellites, ground stations, AOIs, coverage, and links stay aligned during pan, zoom, drag, and simulation playback.
- Hover and tooltip placement stay inside the viewport.
- Performance remains smooth on lower-end devices.

## Future Upgrade Path

For a future offline tile upgrade, prefer PMTiles:

- Store offline dark and satellite tiles as single `.pmtiles` files.
- Serve local MapLibre style JSON files from `public/maps`.
- Register the PMTiles protocol with MapLibre.
- Keep local equirectangular textures as the final fallback.

For deeper 3D zoom quality, improve `TiledGlobeLayer` with:

- Adaptive quadtree LOD.
- Tile cache eviction by camera distance and screen size.
- Frustum and horizon culling.
- Optional normal/height detail only after profiling shows enough GPU budget.

Do not add these future upgrades unless the existing 2D/3D behavior and edit workflows are covered by manual testing.
