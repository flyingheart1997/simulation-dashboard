# System Architecture

The Antaris Visualization system is engineered for extreme performance, specifically designed to render and simulate thousands of orbital entities (satellites and ground stations) smoothly within a web browser.

## Separation of Concerns
The fundamental architectural principle of this system is the **complete decoupling of the React/DOM lifecycle from the WebGL render loop**.

### 1. The React Layer (`page.tsx`, `OriginalSimulation.tsx`)
- Responsible only for mounting the container DOM element and supplying initial seed data and mode configuration via props.
- It initializes the `SimulationManager` but does *not* hold simulation state.
- Public integration props include `onlineMap`, `editMode`, `mapType`, and `viewType`.

### 2. The Store Layer (`simulationStore.ts` using Zustand)
- Acts as the central nervous system.
- Maintains the authoritative state of the simulation: time, speed, camera modes, selection states, visibility toggles, and satellite configurations.
- Handles time propagation (calculating the next simulation time based on Delta-T and speed).
- Crucially, it manages its own subscription model via a custom `subscribe()` and `notify()` pattern. The notification is throttled to ~30Hz (every 32ms) to prevent overwhelming the UI with rapid updates.

### 3. The Render Loop (`SatelliteSimulation.ts`)
- Built on direct Three.js APIs (bypassing React Three Fiber's standard render loop for maximum performance control).
- Exposes a `tick()` method that is driven by `SimulationManager` via `requestAnimationFrame` (running at a full 60fps).
- Reads directly from the Zustand store's state during `tick()`, without waiting for React state updates.
- Coordinates both 3D and 2D rendering paths:
  - 3D uses `EarthScene`, `TiledGlobeLayer`, satellite batches, ground station meshes, and AOI surface geometry.
  - 2D uses `MapLibreBaseLayer` when `onlineMap=true`, plus `FlatMapLayer` for simulation overlays.
  - Offline mode uses bundled local textures in both 2D and 3D.

### 4. The UI Dashboard (`SimulationDashboard.tsx`)
- Built using **Preact** rather than React to minimize Virtual DOM overhead.
- Subscribes to the `simulationStore`. When the store calls `notify()`, the Preact component forces a re-render.
- Handles all user interactions (settings, time scrubbers, clicking, hovering), which then update the Zustand store, creating a unidirectional data flow.
- In create/edit workflows, the dashboard and store suppress inspect-only overlays so the map behaves as a clean editing workspace.

## The Bridge: `SimulationManager`
`SimulationManager.ts` acts as the orchestrator between the DOM, Preact, and Three.js.
- It creates the Three.js instance (`SatelliteSimulation`).
- It renders the Preact component into the DOM.
- It holds the master `requestAnimationFrame` loop, calling `simulation.tick()` continuously.
