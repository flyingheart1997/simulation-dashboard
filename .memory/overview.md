# Antaris Visualization Project Memory
**Target Audience**: AI Agents / AI Assistants

This file serves as the definitive reference guide to the "Antaris Visualization" project, minimizing the need for full repository scanning in the future.

## 1. Project Identity & Purpose
- **Goal**: A high-performance, real-time 3D orbital visualization platform.
- **Key Capabilities**: Renders up to 10,000 satellites and global ground stations smoothly at 60fps. Handles complex orbital mechanics (SGP4 for TLEs, Keplerian for manual data).
- **Core Aesthetic**: Modern, dark, sci-fi/glassmorphism UI superimposed over a 3D WebGL Earth scene.

## 2. Technology Stack
- **Framework**: Next.js (App Router), React, Preact (used specifically for the UI dashboard to minimize React DOM overhead).
- **3D Rendering**: Three.js, `@react-three/fiber`, `@react-three/drei` (though direct Three.js manipulation is heavily used for performance).
- **Animation**: GSAP (for smooth camera transitions and UI animations).
- **State Management**: Zustand (a single centralized store `simulationStore.ts` handles all data, decoupling UI updates from the 60fps render loop).
- **Physics**: `satellite.js` (for SGP4 propagation of TLE data).
- **Styling**: Tailwind CSS and vanilla CSS (`sim-dashboard-modern.css`).

## 3. Architecture Overview

### 3.1 Separation of Concerns
The biggest architectural decision in this project is the **hard decoupling of React state from the WebGL render loop**. 
- React/Preact are ONLY used to mount the canvas and render the 2D UI overlay (Dashboard, tooltips, settings).
- The 3D scene (`SatelliteSimulation.ts`) runs its own `tick()` function directly using Three.js, completely ignoring React's render cycle. It reads data directly from the Zustand store.

### 3.2 Key Directories
- `src/app/page.tsx`: Main entry point. Mounts the `OriginalSimulation` component.
- `src/modules/simulation/components/`:
  - `OriginalSimulation.tsx`: The React wrapper that mounts the simulation and seeds data.
  - `SimulationDashboard.tsx` (Preact): The glassmorphic UI overlay.
  - `SimulationManager.ts`: Bridges React and the raw Three.js simulation.
  - `SatelliteSimulation.ts`: The core Three.js orchestrator. Sets up the camera, Earth, and rendering loop.
  - `SatelliteInstancedMesh.ts`: Renders thousands of satellites using `THREE.InstancedMesh` for performance.
  - `EarthScene.ts`: Procedures the Earth with day/night shaders and multi-spectral layers.
- `src/modules/simulation/services/`:
  - `OrbitPropagator.ts`: Uses SGP4 (`satellite.js`) to convert TLEs to lat/lon/alt. Includes an optimized sliding-window algorithm for rendering orbit paths.
  - `KeplerPropagator.ts`: Converts Keplerian elements to lat/lon/alt for manually inputted satellites.
  - `TleLoader.ts`: Fetches and parses global TLE data.
- `src/modules/simulation/stores/simulationStore.ts`: 
  - Central brain. Holds `SimulationState`. Handles time controls, speed (forward/rewind), selection, and hovering logic. Uses a manual `notify()` system throttled to ~30Hz to prevent overwhelming the UI.

## 4. Crucial Patterns & Optimization Strategies
- **Instanced Rendering**: Satellites are not individual `THREE.Mesh` objects. They are rendered via a single `THREE.InstancedMesh` updating a `Matrix4` buffer directly.
- **Logarithmic Depth Buffer**: Enabled in `WebGLRenderer` to prevent Z-fighting at planetary scales (where coordinates can be massive).
- **Pre-calculation Pass**: In the `tick()` loop, coordinates are converted from Lat/Lon/Alt to Cartesian `Vector3` once per frame and stored in a Map (`satCartesianPositions`), which is then passed to all layers (InstancedMesh, GS, Lines) to avoid redundant math.
- **Event Throttling**: The Zustand store throttles UI notification events to ~30fps, while the Three.js loop runs at 60fps unhindered.

## 5. Orbital Path "Sliding Window"
Orbit paths (lines trailing/leading the satellite) are expensive. The system uses a sliding window (45 min past, 45 min future) that shifts, pushes, and caches points so it only calculates new points instead of re-calculating the entire orbit every frame.

## 6. How to Edit
- **UI Changes**: Look in `SimulationDashboard.tsx` and `sim-dashboard-modern.css`.
- **3D Visuals**: Modify `SatelliteSimulation.ts`, `EarthScene.ts` or `SatelliteInstancedMesh.ts`.
- **Logic/Time**: Modify `simulationStore.ts` or the propagators in `/services`.
