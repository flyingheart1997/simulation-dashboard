# Rendering and UI Pipeline

The Antaris visualization is split into an imperative rendering layer and a lightweight dashboard layer. The renderer owns continuous 2D/3D simulation drawing, while the UI owns controls, settings, tooltips, and workflow state.

## Render Loop

`SimulationManager.ts` owns the `requestAnimationFrame` loop and calls `SatelliteSimulation.tick()` every frame.

`SatelliteSimulation.ts` coordinates:

- Current store state.
- Satellite propagation results.
- 2D or 3D camera mode.
- Map layer updates.
- Entity hover and selection.
- Ground station coverage and communication links.
- AOI, ground target, and create/edit workflows.

The render loop reads from the store directly. It does not wait for React or Preact rerenders, which keeps camera movement and simulation playback responsive.

## 3D Rendering

The 3D view uses Three.js directly.

Key components:

- `EarthScene.ts`: Earth surface, day/night treatment, online tiled globe, offline texture shader, and environmental layers.
- `TiledGlobeLayer.ts`: Online Mapbox/MapLibre raster tiles on the globe.
- `SatelliteInstancedMesh.ts`: Batched satellite rendering.
- `GroundStationMesh.ts`: Ground station markers, coverage, and links.

The 3D globe supports two map paths:

- Online: raster tiles rendered through `TiledGlobeLayer`.
- Offline: local day/night texture blend using the selected day-side map and `earth-night.jpg` for the night side.

`OrbitControls` handles manual rotate and zoom. Programmatic transitions, such as focusing a satellite or switching from 2D back to 3D, use GSAP tweens for smooth camera movement.

## 2D Rendering

The 2D view has a base map plus a synchronized simulation overlay.

Online:

- `MapLibreBaseLayer` renders the base map.
- MapLibre owns pan, zoom, labels, tile loading, and projection.
- `FlatMapLayer` renders simulation entities in a transparent Three.js overlay.

Offline:

- `FlatMapLayer` renders the local equirectangular texture path.
- Day side uses the selected local dark or light texture.
- Night side blends to the local night texture when day/night is enabled.

Overlay objects are reprojected when the simulation time changes or when the map transform changes. The MapLibre layer exposes a transform revision so coverage circles, communication links, orbit paths, AOIs, and icons stay locked to the map during pan and zoom.

## UI Overlay

`SimulationDashboard.tsx` is built with Preact and sits above the renderer.

It handles:

- Settings.
- Map type selection.
- 2D/3D switching.
- Timeline and speed controls.
- Tooltip rendering.
- Create/edit workflow controls.

The dashboard subscribes to the simulation store. Store notifications are throttled so the UI can update at a practical cadence without stealing frame time from WebGL.

## Interaction Model

Inspect mode:

- Satellite and ground station hover shows tooltips.
- Selection updates store state and may focus the camera.
- Satellite orbit paths, visibility cones, ground station coverage, and communication links remain visible based on toggles.
- AOIs render as filled polygons with outlines; vertex handles are hidden.

Create/edit mode:

- Starts in 2D and uses the dark editing map.
- Disables day/night and inspect-only overlays.
- Shows only the active draft or edited object.
- Ground station and ground target creation commits on click, then supports dragging.
- AOI creation previews from the first point to the cursor, requires at least three unique points, and commits on double-click.
- Closed AOIs can be dragged as a single shape.
- Switching to 3D exits create/edit mode and discards invalid AOI drafts.

## Tooltip Rules

Tooltips are positioned from the cursor or projected entity screen location, then clamped inside the viewport. This prevents edge objects from opening panels outside the visible app frame.

## Performance Notes

- Keep high-frequency simulation work inside the imperative render loop.
- Keep Preact updates throttled.
- Use instancing or grouped meshes for repeated entities.
- Reuse materials and geometry buffers where possible.
- Reproject 2D overlay geometry immediately on map movement, but throttle expensive geodesic recomputation.
- Keep day/night, environmental layers, and inspect overlays disabled in edit mode.

More map-specific notes live in [map-rendering-upgrade.md](./map-rendering-upgrade.md).
