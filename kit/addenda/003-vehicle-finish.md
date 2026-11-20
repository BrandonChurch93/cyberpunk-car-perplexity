# 003 · The vehicle's finish

Added November 20, 2026. Brandon's note: the vehicle in the current frames looks far worse than the one in the approved image. From here the vehicle comes first in Phase 3.

## Scope

- This addendum covers how the vehicle is built to hold up and how it is finished: surfaces, paint, water, glass, lamps, wheels and the light on it.
- What the vehicle is, and what its shape matches, stays with `kit/02-VEHICLE.md`.
- A `Vehicle:` line in any task prompt is Brandon's. Append his words to `kit/02-VEHICLE.md` exactly as given, under the date, commit, and follow them. This replaces the rule that such a line is read only while the file is unwritten.

## Surfaces come first

- A panel gets no paint, water or lighting work until its `zebra` view is clean: the stripes run smooth and evenly spaced across the panel, bend only at deliberate creases, and carry on across panel gaps.
- A panel that ripples is rebuilt from fewer, larger, smoother surfaces. It is not patched, blurred, or hidden by darkness, rain or depth of field.
- Creases are crisp and unbroken from end to end. Every edge has a small, even radius that catches a highlight.
- Compare every vehicle build you have, whichever method made it, once and now: `clay` and `zebra` stills from the hero camera and two other angles, scored by one fresh C4. Keep the build with the cleanest surfaces. Work already spent on a build does not count. Code has no priority over a modeling tool.
- Then rebuild and check the kept build in at most `vehicle.maxSurfacePasses` passes. After the last pass go to the round with what exists. C4 carries whatever is still open.

## The finish

Take the vehicle's finish from the approved image: how glossy it is, how wet, how much color it carries, how its lamps glow.

| Part | What has to be there |
| --- | --- |
| Paint | `paint.locked`. A clear, deep gloss with sharp reflections. Surfaces that face the billboard carry its magenta and violet. Surfaces that face the left carry cyan. Surfaces that face the right carry amber. Flake shows in the macro beats only |
| Water | Dense beads on near-horizontal surfaces, each with a bright point. Rivulets on slopes. A thin moving sheet on the glass. Drips from the lower edges |
| Glass | Dark, wet and reflective. The interior is dimly visible behind it. It is never a black void |
| Lamps | Cold white and the brightest neutral thing in frame. Internal structure visible. Halation around them. Each beam visible as a cone through rain and haze, lighting the deck ahead |
| Wheels and tires | Dark, with the brake visible through the spokes. A wet sheen on the tire. Each tire stands in water above its own mirror image |
| Under the vehicle | A clear mirror image of the vehicle in the standing water beneath and ahead of it, and a contact shadow |
| Light | The vehicle is the best lit and sharpest object in the frame. Every panel reads through a reflection or a rim light. Once the lamps are on it is never a silhouette |

## Critics

- C4 judges the vehicle in every Phase 3 round, with `zebra` views from three angles.
- C3 crops always include the paint, the glass, a lamp and a wheel.

## Showing it

In the next update and every update after it, show the vehicle alone from the hero camera in `beauty`, `clay` and `zebra`, beside the approved image.

## Order of work

- Start the comparison of vehicle builds now, in parallel with the camera and world work in addendum 002. They are in different folders.
- Nothing else in addendum 001 or 002 changes.
