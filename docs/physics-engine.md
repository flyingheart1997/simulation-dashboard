# Physics & Orbital Mechanics

The simulation relies on real-world orbital mechanics to calculate the position of satellites at any given `simulationTime`.

## Dual Propagator System

The project supports two distinct methods for determining a satellite's position, allowing flexibility between real-world telemetry and simulated/planned scenarios.

### 1. SGP4 Propagator (`OrbitPropagator.ts`)
- Used when global TLE (Two-Line Element) data is loaded.
- Utilizes the `satellite.js` library.
- Given a TLE set (Line 1 & Line 2) and a specific Date/Time, it calculates the ECI (Earth-Centered Inertial) coordinates and converts them into Geodetic coordinates (Latitude, Longitude, Altitude).

### 2. Keplerian Propagator (`KeplerPropagator.ts`)
- A custom, lightweight physics engine built to calculate orbits directly from Keplerian orbital elements (Altitude, Inclination, Eccentricity, RAAN, Argument of Perigee, True Anomaly).
- Highly optimized for speed, performing direct trigonometric calculations to determine mean motion, eccentric anomaly, and ultimately the Earth-fixed geographic coordinates.
- Ideal for manual inputs and "what-if" planning scenarios where TLEs do not exist.

## Orbital Pathing Strategy

Calculating the orbital path (the trail line behind and ahead of a satellite) is computationally expensive, especially for thousands of satellites.

### The Sliding Window Algorithm
To optimize path generation, `OrbitPropagator.ts` uses a sliding window technique:
1. **Short Orbits**: If the total orbit duration is <= 90 minutes, it pre-calculates the entire orbit path linearly.
2. **Long/Infinite Orbits**: If the orbit is continuous (like real-time tracking):
   - It maintains a window of **45 minutes in the past** to **45 minutes in the future**.
   - **Throttling**: The path is only recalculated or shifted every 60 seconds (simulation time).
   - **Array Shifting**: Instead of recalculating all points in the window, it shifts old points out of the array and pushes new points into the array based on the time delta.
   - **Rewind Support**: If time is reversed (negative speed), the algorithm detects the jump, unshifts points at the beginning, and pops points from the end.

## Coordinate System (`coordUtils.ts`)
All propagators return data as `{ lat, lon, alt }` (degrees and kilometers).

Within the Three.js render loop, these are converted to Cartesian `Vector3` coordinates. The Earth is scaled down.
- Radius of Earth = `6371` (units matching kilometers).
- Cartesian conversion uses standard spherical coordinates:
  - `phi` = (90 - lat) * PI / 180
  - `theta` = (lon + 180) * PI / 180
  - `R` = 6371 + alt
  - `x = -(R * sin(phi) * cos(theta))`
  - `z = R * sin(phi) * sin(theta)`
  - `y = R * cos(phi)`
