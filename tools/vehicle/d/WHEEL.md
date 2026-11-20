Standalone front wheel, built by `blender -b --python wheel_glb.py -- ../../../public/assets/vehicle blockout full` (OpenCascade solids for spokes, disc, caliper, nuts; lathed tire and barrel).
Files: `public/assets/vehicle/d-wheel-full.glb` and `d-wheel-blockout.glb`, metres, glTF Y up, one root node `wheel`.
The hub center is at the origin and the axle runs along +X with the spoke face toward +X (outboard for a left wheel); the wheel spins about X.
Load with `new GLTFLoader().loadAsync(url)`, take `gltf.scene`, and place it at the hub: front left at (0.860, 0.34675, 1.286) in car B's frame if its nose is +Z and +X is left.
For a right wheel use a mirrored clone (`scale.x = -1`) and flip material `side` or reverse winding as car B already does for its own wheels.
Child nodes: `wheel tire`, `wheel rim barrel`, `wheel spokes`, `wheel center cap`, `wheel nuts`, `wheel disc`, `wheel caliper`; the disc and caliper do not spin, so reparent them to the upright if the rim rotates.
Materials (names are the finish): `alloy dark gloss`, `nut dark gloss`, `tire rubber`, `disc carbon ceramic`, `caliper graphite gloss`; swap them by name for car B's own PBR materials.
Tire radius 0.34675 m, section 0.265 m, rim 0.254 m radius; the tread is round, not flattened at the contact patch.
The caliper sits in the rear upper quadrant (12 to 84 degrees above the rearward axis), straddling the disc behind the spokes.
Every node carries `extras.part`; no textures, no lettering, no logos.
