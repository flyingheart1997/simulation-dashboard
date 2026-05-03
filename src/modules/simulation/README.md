# Antaris Simulation Module

High-performance 2D/3D orbital visualization for satellites, ground stations, ground targets, and areas of interest. The module supports both preview/inspect dashboards and dedicated create/edit workspaces.

## Quick Integration

```tsx
import { OriginalSimulation } from '@/modules/simulation/components/OriginalSimulation';

<OriginalSimulation
    satellites={satellites}
    groundStations={groundStations}
    dashboardType="simulation"
    onlineMap={true}
    editMode={false}
    mapType="light"
    viewType="3D"
/>
```

## Component Props

`OriginalSimulation` is the public entry point.

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `satellites` | `KeplerParams[]` | `[]` | Manual satellite definitions. The first two demo satellites may omit `endTime` for open-ended orbit propagation. |
| `groundStations` | `ManualGroundStation[]` | `[]` | Manual ground station seed data. |
| `dashboardType` | `'simulation' \| 'summary' \| 'operate'` | `'simulation'` | Controls orbit timing behavior and dashboard context. |
| `currentTime` | `number` | `undefined` | Optional external simulation time in milliseconds. |
| `onlineMap` | `boolean` | `false` | `true` uses Mapbox/MapLibre sources; `false` uses bundled offline textures. |
| `editMode` | `boolean` | `false` | Starts a 2D create/edit workspace and suppresses inspect-only overlays. |
| `mapType` | `'dark' \| 'light'` | store default | Public map preset. `light` maps internally to the satellite map style. |
| `viewType` | `'2D' \| '3D'` | `'3D'` | Initial view. `editMode=true` always starts in 2D. |

## Preview vs Edit Mode

Preview/inspect usage:

```tsx
<OriginalSimulation
    satellites={satellites}
    groundStations={groundStations}
    onlineMap={true}
    editMode={false}
    mapType="dark"
    viewType="3D"
/>
```

Create/edit workspace usage:

```tsx
<OriginalSimulation
    onlineMap={true}
    editMode={true}
    mapType="light"
    viewType="2D"
/>
```

In edit mode:

- The map is forced to the dark visual style for editing clarity.
- Day/night and environmental data layers are disabled.
- Inspect-only overlays such as satellite visibility cones, GSN coverage, and comm links are hidden.
- The component can start without `satellites` or `groundStations`.
- The user's previous selected map is not overwritten; leaving edit mode restores normal map behavior.

## Map Rendering

The renderer has two map paths.

Online mode (`onlineMap=true`):

- 2D uses `MapLibreBaseLayer` as the base map and renders simulation entities in a synchronized Three.js overlay.
- 3D uses `TiledGlobeLayer` to place Mapbox/MapLibre raster tiles on the globe.
- `NEXT_PUBLIC_MAPBOX_TOKEN` is used when no custom MapLibre style URL is configured.
- Optional style URLs:
  - `NEXT_PUBLIC_MAPLIBRE_DARK_STYLE_URL`
  - `NEXT_PUBLIC_MAPLIBRE_SATELLITE_STYLE_URL`

Offline mode (`onlineMap=false`):

- 2D and 3D use local equirectangular textures from `public/textures`.
- Day side uses the selected `dark` or `light` texture.
- Night side uses `earth-night.jpg` with a smooth sun terminator.
- Offline light mode intentionally avoids extra day-side dark tinting.

Never commit `.env.local` or a secret Mapbox token. Only browser-safe public Mapbox tokens should use the `NEXT_PUBLIC_` prefix.

## Core Components

- `OriginalSimulation.tsx`: React entry point and public prop API.
- `SimulationManager.ts`: Creates the simulation container, dashboard, and render loop.
- `SatelliteSimulation.ts`: Main controller for camera, interaction, state projection, and render orchestration.
- `EarthScene.ts`: 3D Earth, offline day/night shader, online tiled globe, and environmental data layers.
- `FlatMapLayer.ts`: 2D Three.js overlay for satellites, ground stations, targets, AOIs, paths, coverage, and links.
- `MapLibreBaseLayer.ts`: Online 2D base map and projection bridge.
- `TiledGlobeLayer.ts`: Online 3D tiled globe renderer.
- `GroundStationMesh.ts`: 3D ground station icons and communication links.
- `SatelliteInstancedMesh.ts`: Batched satellite rendering.

## Interaction Model

- Inspect mode supports hover, selection, tooltips, camera focus, orbit paths, coverage, and communication links.
- Create/edit modes are 2D-first and operate on map clicks/drags:
  - Ground station: click to create, drag to reposition.
  - Ground target: click to create, drag to reposition.
  - AOI/polygon: click points, double-click to close, drag closed polygons to reposition.
- Polygon creation requires at least three unique points.
- Switching to 3D while in create/edit mode returns to inspect mode and discards invalid draft polygons.

## Performance Notes

- Satellite rendering uses batched point meshes grouped by category.
- UI store notifications are throttled separately from the 60fps WebGL render loop.
- 2D MapLibre movement exposes a transform revision so Three.js overlays reproject immediately during pan/zoom.
- Expensive coverage and communication calculations remain throttled during normal simulation ticks.
- Geometry and materials are reused where practical; generated build artifacts should not be committed.

## Data Shape

Manual satellite input:

```ts
{
    id?: string;
    name: string;
    altitude: number;
    inclination: number;
    eccentricity: number;
    RAAN: number;
    AP: number;
    TA: number;
    startTime: number;
    endTime?: number;
    category?: string;
}
```

Manual ground station input:

```ts
{
    id?: string;
    name: string;
    lat?: number;
    lon?: number;
    latitude?: number;
    longitude?: number;
    country?: string;
    countryCode?: string;
    agency?: string;
    type?: 'military' | 'civilian' | 'commercial' | 'research';
    status?: 'active' | 'inactive' | 'maintenance';
    minElevation?: number;
}
```
