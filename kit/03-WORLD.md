# 03 · The world

## Ground rules

- Units are meters. Y is up. Everything is real-world size.
- Sizes of bays, kerbs, doors, rails, lamp posts and plant come from reference and are logged in `reference/BOARD.md`.
- This is a real city at night with denser signage and more vertical layers than any city has today. That is the only impossible thing about it.
- Nothing floats without support. No free-floating holograms. Light in the air exists only where haze or rain catches a beam from a visible source.
- Nothing is clean, new or perfectly straight. Every surface has a history: wear, stains, repairs, drips, dents.
- Nothing repeats visibly. No two neighboring windows, signs, stains or puddles are copies.

## The deck

The top level of a multi-storey car park, open to the sky, well above street level.

- Surface: sealed concrete or asphalt, worn. Painted bay lines and arrows scuffed by tires. Expansion joints. Drain grates. Low spots that hold water. Oil stains. Tire marks. Patched repairs in a slightly different tone.
- Edges: concrete parapet with a steel rail. Kerbs and wheel stops.
- Structures: a stair and lift core with a lit doorway and a wayfinding sign. A ramp down with a barrier arm. A pay station.
- Services: light poles, conduit, junction boxes, a security camera, rooftop plant with vents and ducts.
- The deck is empty apart from the vehicle.
- The vehicle is parked across the bay lines, not neatly inside one.

## The city

- Towers on every side, all taller than the deck, at several distances.
- Near buildings: windows you can see into. Rooms have depth and parallax, with different contents and different light in each.
- Middle distance: signage, balconies, fire stairs, air conditioning units, cables, pipes.
- Far distance: a skyline that dissolves into rain and haze.
- An elevated rail line or road crosses the middle distance with moving lights.
- Aircraft lights cross the sky slowly. Aviation warning lights blink on the tallest roofs.
- Neighboring roofs carry water tanks, antennas, dishes and plant.

## Signage

- Types: neon tube, LED panel, backlit box, painted wall sign lit by a spot.
- One large animated LED billboard faces the deck. Its changing color washes over the vehicle and the wet surface. This is the main source of moving reflections on the paint.
- Billboard content is abstract: slow gradients and shapes. No faces, figures, products or brands.
- Sign text comes only from `signage` in the config. Use the `generic` list freely.
- Before using a name from `signage.invented`, search the web for it. If it matches a known brand, replace it in the config with another invented name and log the change.
- Latin letters, numerals and simple pictograms only.
- Some signs are damaged: a dead tube, a flickering segment, a cracked panel, water inside a housing.

## Weather

- Steady heavy rain with gusting wind. No lightning.
- Drops fall at terminal velocity for their size. Large drops fall at about 9 meters per second. Streak length on screen follows from that speed and the shutter.
- Gusts change the angle of the rain over time, driven by seeded noise that is periodic over the film.
- Rain is layered: near drops as individual streaks, some out of focus close to the lens. Middle distance as dense streaks. Far distance as haze.
- Rain is visible mainly where it is backlit or crosses a beam. In front of dark areas it almost disappears. This is how rain looks on camera.
- Splashes: small crowns on hard surfaces, on the vehicle, on the parapet. A low mist hangs just above the deck where the rain is heaviest.
- Standing water: puddles sit in the low spots. Rings spread from each drop and overlap. Water creeps toward the drains.
- Run-off: beads on near-horizontal coated surfaces. Rivulets on slopes. Sheets and drips from lower edges. Water streams off the parapet rail and the lip of every roof.
- Steam rises from the rooftop plant and from one drain.

## Air

- Haze is thick enough to give every light a glow and to separate the depth layers of the city.
- Beams are visible where they cross rain: the vehicle's lamps, the deck light poles, the billboard.
- The cloud base is low. The city lights it from below in the colors of its signage.

## Light sources

There is no moon and no clean white light.

| Source | Role |
| --- | --- |
| City glow on the cloud base | Soft colored fill from above |
| The animated billboard | Moving colored key light on the vehicle and deck |
| A cool sign group on one side | Cool rim light |
| A warm sign group on the other side | Warm rim light |
| Deck light poles | Pools of light on the deck. One flickers faintly |
| Stair core doorway | A spill of interior light across the wet surface |
| Windows of near buildings | Small warm and cool points with depth |
| The vehicle's lamps | Off, then on, then off. Driven by the beats in `kit/01-FILM.md` |

- Exposure is a night exterior on a fast lens. Sign highlights roll off softly. Shadows keep detail.
- Every flicker, blink and animation is seeded and periodic over the film length.
