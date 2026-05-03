# Antaris Visualization

High-performance orbital simulation dashboard for visualizing satellites, ground stations, ground targets, and areas of interest in synchronized 2D and 3D map views.

The app is built with Next.js, Three.js, MapLibre, Preact, Zustand, and `satellite.js`. The rendering stack is designed to keep simulation playback smooth while preserving accurate geospatial interaction for inspect and create/edit workflows.

## Highlights

- 2D and 3D orbital visualization with shared simulation state.
- Online maps through Mapbox/MapLibre tile sources.
- Offline maps through bundled local Earth textures.
- Dark and light map presets.
- Day/night visualization for preview/inspect mode.
- Create/edit workflows for ground stations, ground targets, and AOI polygons.
- Satellite hover, selection, orbit paths, ground station coverage, and communication links.
- Batched WebGL rendering and throttled UI updates for performance.

## Quick Start

```bash
pnpm install
pnpm dev
```

The dev server runs on:

```text
http://localhost:3001
```

Production verification:

```bash
pnpm exec tsc --noEmit
pnpm build
```

## Environment

Copy `.env.example` to `.env.local` for local configuration:

```bash
cp .env.example .env.local
```

Available variables:

```bash
NEXT_PUBLIC_MAPBOX_TOKEN=
NEXT_PUBLIC_MAPLIBRE_DARK_STYLE_URL=
NEXT_PUBLIC_MAPLIBRE_SATELLITE_STYLE_URL=
```

Use only browser-safe public Mapbox tokens with the `NEXT_PUBLIC_` prefix. Do not commit `.env.local`.

## Main Integration

`OriginalSimulation` is the public entry point:

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

Key props:

| Prop | Type | Purpose |
| --- | --- | --- |
| `onlineMap` | `boolean` | `true` uses Mapbox/MapLibre tiles; `false` uses bundled offline textures. |
| `editMode` | `boolean` | Starts the clean 2D create/edit workspace. |
| `mapType` | `'dark' \| 'light'` | Public map preset. `light` represents the satellite-style map. |
| `viewType` | `'2D' \| '3D'` | Initial view. Edit mode always starts in 2D. |
| `satellites` | `KeplerParams[]` | Manual satellite seed data. |
| `groundStations` | `ManualGroundStation[]` | Manual ground station seed data. |

More details: [simulation module README](./src/modules/simulation/README.md).

## Map Modes

Online mode:

- 2D uses `MapLibreBaseLayer`.
- 3D uses `TiledGlobeLayer`.
- Custom MapLibre style URLs are preferred when provided.
- Mapbox is used through `NEXT_PUBLIC_MAPBOX_TOKEN` when style URLs are not configured.

Offline mode:

- Uses `public/textures/earth-dark.png`, `earth-light.jpg`, and `earth-night.jpg`.
- Day side uses the selected dark/light texture.
- Night side blends to the night texture with a smooth terminator.

Edit mode:

- Forces the dark editing map.
- Disables day/night and inspect-only overlays.
- Shows only the active draft object or object being edited.

## Project Structure

```text
.
├── docs/                         # Architecture and rendering notes
├── public/textures/              # Offline map and sky textures
├── src/app/                      # Next.js app entry
└── src/modules/simulation/       # Simulation renderer, services, store, types, utils
```

Important docs:

- [Simulation module](./src/modules/simulation/README.md)
- [Map rendering architecture](./docs/map-rendering-upgrade.md)
- [Rendering and UI pipeline](./docs/rendering-and-ui.md)
- [System architecture](./docs/architecture.md)
- [State management](./docs/state-management.md)
- [Physics engine](./docs/physics-engine.md)

## Development Notes

- Keep `.env.local` out of git.
- Keep generated build artifacts such as `tsconfig.tsbuildinfo` out of commits unless intentionally changed.
- Prefer preserving existing interaction behavior when changing map rendering.
- For map upgrades, keep 2D/3D visual consistency, online/offline behavior, and edit-mode clarity intact.
