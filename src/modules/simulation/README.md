# Antaris Satellite Simulation Dashboard

A high-performance, real-time orbital mechanics simulation and visualization platform built with **Three.js**, **Preact**, and **TypeScript**.

## 🛰️ Project Overview
This dashboard provides a robust, interactive 3D/2D visualization of global satellite networks. It is designed to handle thousands of satellites simultaneously at 60 FPS while providing detailed telemetry, communication links, and ground station coverage analysis.

### 🎯 Problem Solved
Visualizing orbital data (TLE/Kepler) require complex transformations between Geodetic (Lat/Lon) and Cartesian (XYZ) spaces, time-synchronized propagation, and high-performance rendering. This project provides a "plug-and-play" simulation module that handles these complexities out-of-the-box.

---

## 🛠️ Technology Stack
- **Rendering**: [Three.js](https://threejs.org/) (WebGL) for 3D/2D projection.
- **UI Framework**: [Preact](https://preactjs.com/) for a lightweight, high-performance dashboard overlay.
- **State Management**: Custom Singleton Store pattern with atomic updates and notification throttling.
- **Physics**: SGP4 (for TLE) and Keplerian Propagators for orbital path prediction.
- **Language**: TypeScript (Strict Mode).

---

## 🏗️ Architecture & Modules

### 1. State Management (`simulationStore.ts`)
The "Brain" of the simulation. It manages:
- **Orbital Timer**: A unified clock that supports real-time playback, fast-forward/rewind, and external prop-driven time synchronization.
- **Entity State**: Map of `SimulatedSatellite` objects and `GroundStation` arrays.
- **Performance Protection**: Implements a **32ms UI Throttler** (30Hz) to prevent CPU spikes during high-frequency time updates, while allowing the WebGL layer to remain at a fluid **60Hz**.

### 2. Rendering Engine (`SimulationRenderer.ts` & `EarthScene.ts`)
- **Procedural Earth**: A multi-layered sphere with Day/Night shaders, atmosphere scattering, and dynamic illumination.
- **Instanced Rendering**: Uses `THREE.InstancedMesh` for satellites, enabling the rendering of 10,000+ entities with a single draw call.
- **Dynamic Layers**:
    - **Visibility Cones**: Visualizes satellite-to-earth coverage.
    - **Comm Links**: Real-time curved Bezier links between satellites and ground stations.
    - **Ground Coverage**: GSN (Ground Station Network) coverage bubbles.

### 3. Orbital Mechanics (`OrbitPropagator.ts` & `KeplerPropagator.ts`)
- **TLE Processing**: Decodes Two-Line Element sets via SGP4.
- **Keplerian Models**: Handles orbital parameters (Altitude, Inclination, RAAN, etc.) for manual satellite seeding.
- **Sliding Window Optimization**: Implements an efficient "Shift & Push" caching mechanism. Instead of recalculating paths every frame, the engine maintains a 90-minute window and only propagates new points every 60 seconds of simulation time.
- **60-Minute "Pin" Rule**: To ensure stability during initialization, the orbital path is pinned to the start of the simulation for the first 60 minutes, transition to a dynamic sliding window only after the 1-hour mark.

---

## 🚦 Interaction Modes

The dashboard supports three distinct operational modes via the `dashboardType` prop:

| Mode | Behavior |
| :--- | :--- |
| **Simulation** | Fixed timeline. Stops automatically at `endTime`. Sliding window active after 60m. |
| **Summary** | Looping playback between `startTime` and `endTime`. Sliding window active after 60m. |
| **Operate** | Real-time sliding window (pinned for <60m, then 45m past / 45m future). |

---

## 🔌 Integration (API)

### `OriginalSimulation` Component
The primary entry point for integrating the dashboard into any React/Next.js application.

```tsx
<OriginalSimulation 
    satellites={myKeplerData}      // Optional manual seeding
    groundStations={myGSData}      // Custom ground stations
    dashboardType="simulation"     // simulation | summary | operate
    currentTime={externalValue}    // Optional: Drive clock from parent
/>
```

---

## ⚡ Performance Standards
- **Draw Calls**: Minimized via instancing (Satellites) and point clouds (Stars/Background).
- **Update Loop**: Decoupled store updates from UI re-renders ($30Hz \text{ vs } 60Hz$).
- **Memory**: Automatic cleanup of Three.js geometries and textures on component unmount.

---

## 📜 Coding Standards
1. **Type Safety**: No `any` allowed. Every entity must implement an interface from `types.ts`.
2. **Single Source of Truth**: All time calculations MUST go through `simulationStore.simulationTime`.
3. **Modularity**: UI logic (Preact) must remain separate from Rendering logic (Three.js).
4. **Coordinate Accuracy**: Use `RADIUS = 6371` km as the constant Earth radius for all calculations.

---

## 📂 Directory Structure
- `/components`: UI Dashboard and Three.js layers.
- `/stores`: Performance-optimized state management.
- `/renderers`: WebGL initialization and per-frame logic.
- `/services`: Physics propagators and TLE loaders.
- `/utils`: Heavy-lifting math and coordinate utilities.
