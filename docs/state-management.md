# State Management (Zustand)

`simulationStore.ts` acts as the single source of truth for the entire application, bridging the declarative UI (Preact) and the imperative render loop (Three.js).

## State Structure

The state object (`SimulationState`) contains:
- **Core Entities**: Maps/Arrays of Satellites and Ground Stations.
- **Time Control**: `simulationTime`, `speed`, `isPlaying`.
- **Interaction State**: `selectedSatelliteId`, `hoveredSatelliteId`, screen positions for tooltips.
- **Visual Toggles**: Visibility filters, layer toggles, day/night toggles, map type, online/offline map mode, and view modes (2D/3D).
- **Workspace State**: Inspect, create, and edit modes for ground stations, ground targets, and AOIs.

## The Observer Pattern

Instead of relying on React Context or hooks that bind directly to components and trigger re-renders natively, the store implements a custom Observer pattern:
```typescript
private listeners: Set<(state: SimulationState) => void> = new Set();

subscribe(listener: (state: SimulationState) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
}

private notify(force: boolean = false) {
    const now = Date.now();
    if (!force && now - this.lastNotifyTime < this.notifyThrottleMs) return;
    this.lastNotifyTime = now;
    this.listeners.forEach(l => l({ ...this.state }));
}
```

## The Update Loop

The `update(dtMs: number)` function is called externally (usually by `SimulationManager` inside the `requestAnimationFrame` loop).
1. It calculates the next `simulationTime` based on the delta-time and the current `speed`.
2. It handles bounds checking (auto-pausing if the time reaches the start/end of a designated simulation window).
3. It iterates over all satellites and calls `propagator.propagate(effectiveTime)` to update their lat/lon/alt.
4. Finally, it calls `this.notify()` to alert the UI that positions or time have changed.

## Initialization Modes

The store can operate in two primary modes:
1. **Global TLE Mode (`init()`)**: Fetches thousands of TLEs from `TleLoader.ts`. It manages an `isLoading` and `loadingProgress` state to drive the loading screen UI.
2. **Manual Mode (`seedManualData()`)**: Receives explicit arrays of `KeplerParams` and `GroundStation` data from `page.tsx`. This bypasses the API fetch and initializes the physics engines immediately. This is the mode used when integrating the visualization into the broader Antaris platform.

## Integration Mode Props

`OriginalSimulation` passes initial mode options into `SimulationManager`, which seeds the store and renderer:

- `onlineMap=true` enables Mapbox/MapLibre rendering for 2D and 3D.
- `onlineMap=false` keeps the renderer on bundled offline textures.
- `mapType='dark'` starts with the dark map.
- `mapType='light'` starts with the satellite-style map.
- `viewType='2D'` or `viewType='3D'` controls the initial view.
- `editMode=true` starts a 2D editing workspace, forces the dark editing map, disables day/night overlays, and hides inspect-only objects.

Create/edit state is deliberately separate from inspect state. Invalid AOI drafts with fewer than three unique points are not committed when the user leaves edit mode or switches to 3D.
