# Antaris Satellite Simulation Dashboard (V2)

A state-of-the-art, high-performance orbital visualization platform. Engineered for precision, visual excellence, and extreme scalability.

## 🛰️ Key Features

### 1. High-Fidelity Rendering
- **Surface-Aligned Ground Stations**: GS icons are rendered as flat, sci-fi radar decals aligned to the Earth's surface normal.
- **Logarithmic Depth Buffer**: Resolves Z-fighting and flickering at planetary scales.
- **Glassmorphism UI**: High-fidelity dashboard overlay with real-time telemetry.

### 2. Intelligent Camera System
- **Unified Zoom (10,000km)**: Consistent orbital follow distance for both Satellites and Ground Stations.
- **Context-Aware Resets**: Smooth camera transitions back to mode-specific (2D/3D) "Home" positions on deselection.
- **Enhanced Visibility**: Calibrated default zoom levels (3D: 24,000km) for immediate visual impact.

### 3. Advanced Physics & Optimization
- **Dual Propagators**: 
    - **SGP4**: Precise TLE-based propagation.
    - **Keplerian**: High-speed propagation for manual orbital parameters.
- **10k Satellite Stability**: Achieved through `THREE.InstancedMesh` and direct Map iteration (GC-free loop).
- **Altitude-Aware Entities**: Ground Stations elevated to 100km to clear all terrain and data layers.

---

## 🏗️ Technical Architecture

### Core Components (`/src/modules/simulation/components`)
- **`SatelliteSimulation.ts`**: The master controller orchestrating camera, scene, and interaction.
- **`GroundStationMesh.ts`**: Managed group of surface-aligned circular meshes with modern radar textures.
- **`EarthScene.ts`**: Procedures Earth with optimized Day/Night shader and multi-spectral data layers.
- **`SatelliteInstancedMesh.ts`**: Ultra-high performance instanced rendering for thousands of entities.

### Services & Propagators (`/src/modules/simulation/services`)
- **Kepler/Orbit Propagators**: Optimized math for real-time and fast-forward time-scrubbing.
- **TleLoader**: Async processing for bulk TLE data ingestion.

---

## 🚦 Interaction Logic
- **Hover**: Occlusion-aware hovering (Earth blocks back-side entities).
- **Selection**: Click any entity to focus. Camera will orbit the target at 10,000 km.
- **Reset**: Click empty space or the Earth to return to the global mode-specific view.

---

## 📂 Project Structure
```text
simulation/
├── components/          # Three.js Layers & UI
├── services/            # Mechanical & Propagation logic
├── stores/              # Performance-scaled state (30Hz UI / 60Hz Render)
├── utils/               # Coordinate & Sun-math utilities
└── modules/             # Shared Types & Constants
```

---

## 📜 Integration
Use the `OriginalSimulation` component for seamless integration.
```tsx
<OriginalSimulation 
    satellites={mockData} 
    groundStations={gsData} 
    dashboardType="simulation"
/>
```
