# 01 · The film

## What it is

- Working title: `name` in the config.
- A supercar parked alone on the top deck of a car park, at night, in heavy rain, inside a dense neon city.
- Length `film.durationSeconds` seconds at `film.fps` frames per second.
- No people. No dialogue. No titles, captions or logos burned into the picture.
- Sound is added later in the edit. The film is built and judged silent.

## Where it runs

- X. Video starts playing muted in the timeline.
- Video at or under `platform.loopsAtOrUnderSeconds` seconds loops. This film loops with no visible seam when `film.loopSeamless` is true.
- The master is `formats.master`. The vertical version is `formats.vertical`.
- The post will say this was built with Perplexity Computer. The film has to make that hard to believe.

## The viewer

- Someone scrolling who has seen a thousand generated videos and scrolls past all of them.
- They stop because it looks filmed.
- They stay because each new shot survives a closer look.
- They replay it to work out whether it is real.

## Rules for the opening

- Frame 0 is the poster frame. No fade in from black. The first frame is already a finished picture.
- The first `film.hookSeconds` seconds have to work muted, on a phone, at a glance.
- The subject is readable in the poster frame at `critics.phonePreviewWidthPx` wide.

## Beats

Timings are in `beats` in the config. The beat ids below match.

| Beat | What happens | Camera | What it has to prove |
| --- | --- | --- | --- |
| `arrival` | The vehicle sits dark. Only the city lights it: rim light from signs, reflections in standing water | Wide and low. Slow push toward the vehicle | The place is real. Scale, depth, rain, air |
| `wake` | The vehicle's lamps come on in stages. Beams cut through the rain. The wet deck lights up | Continues the push and settles on a front three-quarter view | Light behaves. Rain shows where it is backlit. Reflections answer the lamps |
| `paint` | Beads sit on the clearcoat. Sign reflections slide and bend across the panel. One rivulet breaks loose and runs | Macro glide along a body panel. Shallow depth of field | Paint is a layered material. Water is water |
| `wheel` | Drips fall from the arch. Water sits in the tread | Macro on a front wheel: rim, brake disc, caliper, tire sidewall | Manufactured parts hold up at macro distance |
| `lamp` | Water on the outer lens bends the light behind it | Macro into a lit lamp | Glass and light sources have depth and internal structure |
| `detail` | Light rakes across the surface | Close pass over the vehicle's `detail` anchor | Fine repeating pattern with no shimmer, moire or aliasing |
| `ignition` | The engine starts. Heat shimmer at the exhaust. Steam where rain meets hot metal. Vibration shakes beads loose. Tail lamps flare. Exhaust pulses ripple the nearest puddle | Rear three-quarter, low | The machine is alive. Secondary motion is correct |
| `return` | Engine and lamps shut down | Pulls back and settles into the exact opening composition | The loop closes |

## The loop

- The state of everything at `film.durationSeconds` equals the state at 0: camera, lamps, engine, rain phase, sign animation, puddle ripples, grain.
- Every animated system is periodic over the film length or returns to its start value.
- The frame one past the last frame matches frame 0. G6 in `kit/07-QUALITY-BAR.md` is the automated floor. C5 judges the seam by eye.

## Camera rules

- The camera is operated like real equipment: dolly, slider, crane or gimbal.
- Moves have mass. Starts and stops are eased. No instant change of direction.
- A small seeded operator motion sits on top of every move. It is never a visible shake.
- Focal lengths come only from `lens.focalLengthsMm`.
- Focus is pulled, never snapped.
- Cuts happen only at beat boundaries. Inside a beat the move is continuous.
- The camera never passes through geometry and never shows the edge of the world.
- Rain can land on the front element in at most one beat.

## The vertical version

- Same timeline, same beats, same frame count.
- Each beat is reframed for `formats.vertical`. It is not a crop of the master.
- The subject stays in the middle band of the frame, clear of where X draws its interface.

## Sound hand-off

The Builder writes `cut/CUES.md`:

- A timecode for every audible event: rain bed, each lamp stage, starter, engine catch, idle, shutdown, drips, steam, sign hum.
- A note on where music should enter, land and resolve so the loop still works.

## Not in this film

- People or animals.
- Titles, logos or interface overlays.
- An intro of someone typing a prompt. The team adds that in the edit with its own tools.

## What the Builder may tune

- Beat boundaries, when the motion critic's notes call for it. The total stays at `film.durationSeconds`.
- `film.heroFrameSeconds` and `film.macroFrameSeconds`, if the best moment of the `wake` or `paint` beat moves.
- Every change is made in the config and logged.
