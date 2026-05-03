# Rendering and UI Pipeline

The visual output of the Antaris Visualization is split into an immersive 3D WebGL scene and a responsive 2D UI overlay.

## 3D Rendering (`SatelliteSimulation.ts`)

The Three.js scene is carefully constructed to handle planetary scale coordinates without visual artifacts.

### Key Optimization: InstancedMesh
Rendering 10,000 independent `THREE.Mesh` objects would crush the browser. Instead, `SatelliteInstancedMesh.ts` uses `THREE.InstancedMesh`.
- A single geometry (e.g., a simple box or sphere) and material is used for all un-focused satellites.
- A `Float32Array` holding the transformation matrices (`Matrix4`) is updated every frame.
- The `updatePositions` method iterates over the `satCartesianPositions` map (pre-calculated earlier in the frame), updates the translation matrix for that specific instance index, and flags `instanceMatrix.needsUpdate = true`.

### Logarithmic Depth Buffer
Because the camera can zoom from 500km to 500,000km, the near and far clipping planes have extreme ranges. The `WebGLRenderer` is instantiated with `logarithmicDepthBuffer: true` to dynamically adjust depth precision and eliminate Z-fighting (flickering of overlapping surfaces, especially on the Earth sphere).

### Focused Models vs. Instanced Models
When a satellite is clicked or hovered, a high-fidelity 3D model (built from primitives in `createSatelliteModel`) is instantiated and placed at the satellite's exact coordinate.
- The high-fidelity model calculates its velocity vector (by propagating 1 second into the future) to orient itself using `lookAt()` so it always faces its direction of travel.
- The instanced point for that specific satellite remains, but the detailed model provides visual focus.

### Camera Transitions (GSAP)
`OrbitControls` handles standard mouse dragging and zooming. However, mode switches (2D to 3D) or focusing on a specific satellite use `gsap.to()` to smoothly tween the `camera.position` and `controls.target`.

## The UI Overlay (`SimulationDashboard.tsx`)

The dashboard is built with Preact and sits above the Three.js canvas.

## Future 2D Map Upgrade

The current stable 2D map path uses local equirectangular textures so 2D and 3D remain reliable online and offline. A future zoom-perfect map design upgrade should not stretch WebMercator tiles onto this plane. Use the projection-correct MapLibre + simulation overlay plan documented in [map-rendering-upgrade.md](./map-rendering-upgrade.md).

### The Throttle Mechanism
The dashboard calls `simulationStore.subscribe(() => this.forceUpdate())`. 
Because the physics update loop (`update()`) runs constantly to advance time, triggering a React/Preact update every frame would destroy performance.
The `simulationStore` restricts calls to `notify()` to a maximum frequency of ~30Hz (32ms throttle). This ensures the UI remains responsive but doesn't steal CPU cycles from WebGL.

### Time Scrubber & Controllers
The bottom bar contains a custom speed controller.
- Scrubbing the timeline or changing speeds updates the store's `speed` variable.
- The store's time calculation multiplies the raw delta-time (from `requestAnimationFrame`) by the `speed` variable.
- Rewinding (negative speed) is fully supported, and the physics engines naturally calculate positions backward.

### Interactive Tooltips
Mouse movements in `SatelliteSimulation.ts` use a `Raycaster`. 
If a satellite or ground station is hit, it writes the `hoveredSatelliteId` and `tooltipPos` (screen coordinates) into the store.
The Dashboard component reads these screen coordinates and renders an absolute-positioned DOM element over the WebGL canvas, providing immediate telemetry feedback.
