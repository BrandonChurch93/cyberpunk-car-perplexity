import * as THREE from 'three'
import type { CameraState } from '../../core/lens'
import { patchFilmLighting } from '../../core/lights'
import { layers } from '../../core/contract'
import { insertAfter, patchMaterial, replaceOnce } from '../../materials/patch'
import { type BeadClass, beadLayers, cellDrops, dominantAxis, geometryMinMm, maxDensity } from './beads'
import { surfHash3 } from './hash'

/** Beyond this distance from the lens a drop is small enough on screen, and soft enough in focus, for the shader field. */
export const geometryRange = 1.7
const maxInstances = 40000
const chunk = 4096
/** A drop becomes geometry only when it spans this many pixels; smaller ones stay in the shader field. */
const minPixels = 5

/** Smallest diameter over distance that is drawn as geometry for this lens and frame width. */
export function geometryAngle(camera: CameraState, widthPx: number): number {
  return (minPixels * camera.sensorWidthMm) / camera.focalMm / widthPx
}

interface Source {
  mesh: THREE.Mesh
  bead: BeadClass
  positions: Float32Array
  normals: Float32Array
  centroids: Float32Array
  triRadius: Float32Array
  triangles: number
  index: ArrayLike<number> | null
  /** Open edges and sharp folds a drop may not straddle, hashed by cell in object space. */
  edges: EdgeGrid
}

const edgeCell = 0.02
const foldCos = Math.cos(THREE.MathUtils.degToRad(60))

class EdgeGrid {
  private readonly cells = new Map<string, number[]>()
  private readonly seg: number[] = []
  private readonly a = new THREE.Vector3()
  private readonly b = new THREE.Vector3()
  private readonly line = new THREE.Line3()
  private readonly q = new THREE.Vector3()

  add(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    const id = this.seg.length / 6
    this.seg.push(ax, ay, az, bx, by, bz)
    const lo = [Math.min(ax, bx), Math.min(ay, by), Math.min(az, bz)].map((v) => Math.floor(v / edgeCell))
    const hi = [Math.max(ax, bx), Math.max(ay, by), Math.max(az, bz)].map((v) => Math.floor(v / edgeCell))
    if ((hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1) > 512) return
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      const key = `${x},${y},${z}`
      const list = this.cells.get(key)
      if (list) list.push(id)
      else this.cells.set(key, [id])
    }
  }

  /** Whether any edge passes within `reach` of p. `reach` stays under one cell. */
  near(p: THREE.Vector3, reach: number): boolean {
    const cx = Math.floor(p.x / edgeCell), cy = Math.floor(p.y / edgeCell), cz = Math.floor(p.z / edgeCell)
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++) {
      const list = this.cells.get(`${x},${y},${z}`)
      if (!list) continue
      for (const id of list) {
        const o = id * 6
        this.line.set(this.a.fromArray(this.seg, o), this.b.fromArray(this.seg, o + 3))
        this.line.closestPointToPoint(p, true, this.q)
        if (this.q.distanceToSquared(p) < reach * reach) return true
      }
    }
    return false
  }
}

/** Edges used by one triangle only, the panel gaps, and edges where the faces either side fold by more than 60 degrees. */
function edgeGrid(pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, index: ArrayLike<number> | null, triangles: number): EdgeGrid {
  const grid = new EdgeGrid()
  const weld = new Map<string, number>()
  const id = (i: number): number => {
    const key = `${Math.round(pos.getX(i) * 2e4)},${Math.round(pos.getY(i) * 2e4)},${Math.round(pos.getZ(i) * 2e4)}`
    let v = weld.get(key)
    if (v === undefined) {
      v = weld.size
      weld.set(key, v)
    }
    return v
  }
  const at = (t: number, k: number): number => (index ? index[t * 3 + k] : t * 3 + k)
  const faces = new Map<string, { n: THREE.Vector3; i: number; j: number; count: number; fold: boolean }>()
  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3()
  for (let t = 0; t < triangles; t++) {
    const v = [at(t, 0), at(t, 1), at(t, 2)]
    pa.fromBufferAttribute(pos, v[0])
    pb.fromBufferAttribute(pos, v[1])
    pc.fromBufferAttribute(pos, v[2])
    const n = new THREE.Vector3().crossVectors(pb.clone().sub(pa), pc.clone().sub(pa))
    if (n.lengthSq() < 1e-20) continue
    n.normalize()
    for (let k = 0; k < 3; k++) {
      const i = v[k], j = v[(k + 1) % 3]
      const a = id(i), b = id(j)
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      const e = faces.get(key)
      if (!e) faces.set(key, { n, i, j, count: 1, fold: false })
      else {
        e.count++
        if (e.n.dot(n) < foldCos) e.fold = true
      }
    }
  }
  for (const e of faces.values()) {
    if (e.count !== 1 && !e.fold) continue
    grid.add(pos.getX(e.i), pos.getY(e.i), pos.getZ(e.i), pos.getX(e.j), pos.getY(e.j), pos.getZ(e.j))
  }
  return grid
}

/** A unit footprint, unit height spherical cap for one contact angle. Past 90 degrees the side bulges out over the footprint. */
export function capTemplate(contactDegrees: number, rings: number, segments: number): THREE.BufferGeometry {
  const theta = THREE.MathUtils.degToRad(contactDegrees)
  const radius = 1 / Math.sin(theta)
  const centerY = -radius * Math.cos(theta)
  const height = radius * (1 - Math.cos(theta))
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  positions.push(0, 1, 0)
  normals.push(0, 1, 0)
  for (let r = 1; r <= rings; r++) {
    const phi = (theta * r) / rings
    for (let s = 0; s < segments; s++) {
      const psi = (s / segments) * Math.PI * 2
      const nx = Math.sin(phi) * Math.cos(psi)
      const ny = Math.cos(phi)
      const nz = Math.sin(phi) * Math.sin(psi)
      positions.push(radius * nx, (centerY + radius * ny) / height, radius * nz)
      const n = new THREE.Vector3(nx, ny * height, nz).normalize()
      normals.push(n.x, n.y, n.z)
    }
  }
  for (let s = 0; s < segments; s++) indices.push(0, 1 + ((s + 1) % segments), 1 + s)
  for (let r = 1; r < rings; r++) {
    const a = 1 + (r - 1) * segments
    const b = 1 + r * segments
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments
      indices.push(a + s, a + s1, b + s, a + s1, b + s1, b + s)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  g.setIndex(indices)
  return g
}

/** Water drops near the lens as real refracting geometry, placed from the same cells as the shader field. */
export class DropGeometry {
  readonly group = new THREE.Group()
  readonly material: THREE.MeshPhysicalMaterial
  /** The same lens for the hero rivulet and its trail beads. */
  readonly runner: THREE.MeshPhysicalMaterial
  /** Water without a cap shape: ribbons and falling drips. */
  readonly plain: THREE.MeshPhysicalMaterial
  private readonly lenses = new Map<number, THREE.MeshPhysicalMaterial>()
  private readonly uniforms: Record<string, THREE.IUniform>
  private readonly sources: Source[] = []
  private readonly pools = new Map<string, THREE.InstancedMesh[]>()
  count = 0

  constructor(meshes: Array<{ mesh: THREE.Mesh; bead: BeadClass }>, uniforms: Record<string, THREE.IUniform>) {
    this.group.name = 'surface water drops'
    this.uniforms = uniforms
    this.material = dropMaterial(uniforms, 100)
    this.runner = dropMaterial(uniforms, 100, true)
    this.plain = dropMaterial(uniforms, null, true)
    for (const { mesh, bead } of meshes) {
      const geometry = mesh.geometry
      const pos = geometry.getAttribute('position')
      const nor = geometry.getAttribute('normal')
      if (!pos || !nor) continue
      const index = geometry.index ? geometry.index.array : null
      const triangles = (index ? index.length : pos.count) / 3
      const centroids = new Float32Array(triangles * 3)
      const triRadius = new Float32Array(triangles)
      const at = (t: number, k: number): number => (index ? index[t * 3 + k] : t * 3 + k)
      for (let t = 0; t < triangles; t++) {
        let cx = 0, cy = 0, cz = 0
        for (let k = 0; k < 3; k++) {
          const i = at(t, k)
          cx += pos.getX(i) / 3
          cy += pos.getY(i) / 3
          cz += pos.getZ(i) / 3
        }
        centroids.set([cx, cy, cz], t * 3)
        let r = 0
        for (let k = 0; k < 3; k++) {
          const i = at(t, k)
          r = Math.max(r, Math.hypot(pos.getX(i) - cx, pos.getY(i) - cy, pos.getZ(i) - cz))
        }
        triRadius[t] = r
      }
      const positions = new Float32Array(pos.count * 3)
      const normals = new Float32Array(pos.count * 3)
      for (let i = 0; i < pos.count; i++) {
        positions.set([pos.getX(i), pos.getY(i), pos.getZ(i)], i * 3)
        normals.set([nor.getX(i), nor.getY(i), nor.getZ(i)], i * 3)
      }
      this.sources.push({ mesh, bead, positions, normals, centroids, triRadius, triangles, index, edges: edgeGrid(pos, index, triangles) })
    }
  }

  private pool(contact: number, small: boolean): THREE.InstancedMesh[] {
    const key = `${contact}:${small}`
    let list = this.pools.get(key)
    if (!list) {
      list = []
      this.pools.set(key, list)
    }
    return list
  }

  private lens(contact: number): THREE.MeshPhysicalMaterial {
    if (contact === 100) return this.material
    let m = this.lenses.get(contact)
    if (!m) {
      m = dropMaterial(this.uniforms, contact)
      this.lenses.set(contact, m)
    }
    return m
  }

  private templates = new Map<string, THREE.BufferGeometry>()

  private template(contact: number, small: boolean): THREE.BufferGeometry {
    const key = `${contact}:${small}`
    let t = this.templates.get(key)
    if (!t) {
      t = small ? capTemplate(contact, 4, 10) : capTemplate(contact, 9, 22)
      this.templates.set(key, t)
    }
    return t
  }

  /** `swept` says whether a drop of this radius at this world point has been taken up by the runner. */
  update(camera: CameraState, widthPx: number, aspect: number, swept: (world: THREE.Vector3, radius: number) => boolean = () => false): void {
    const film = new THREE.PerspectiveCamera(
      THREE.MathUtils.radToDeg(2 * Math.atan(camera.sensorWidthMm / aspect / 2 / camera.focalMm)), aspect, camera.near, camera.far)
    film.position.copy(camera.position)
    film.quaternion.copy(camera.quaternion)
    film.updateMatrixWorld(true)
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(film.projectionMatrix, film.matrixWorldInverse))
    const used = new Map<string, number>()
    const matrix = new THREE.Matrix4()
    const basis = new THREE.Matrix4()
    const sphere = new THREE.Sphere()
    const camObj = new THREE.Vector3()
    const inverse = new THREE.Matrix4()
    const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3()
    const na = new THREE.Vector3(), nb = new THREE.Vector3(), nc = new THREE.Vector3()
    const n = new THREE.Vector3(), gObj = new THREE.Vector3(), down = new THREE.Vector3(), side = new THREE.Vector3()
    const center = new THREE.Vector3(), world = new THREE.Vector3(), objCenter = new THREE.Vector3()
    this.count = 0
    const angle = geometryAngle(camera, widthPx)
    for (const src of this.sources) {
      const { mesh, bead } = src
      mesh.updateWorldMatrix(true, false)
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere()
      sphere.copy(mesh.geometry.boundingSphere!).applyMatrix4(mesh.matrixWorld)
      if (sphere.distanceToPoint(camera.position) > geometryRange) continue
      const scale = new THREE.Vector3().setFromMatrixColumn(mesh.matrixWorld, 0).length()
      const rotation = new THREE.Matrix4().extractRotation(mesh.matrixWorld)
      inverse.copy(mesh.matrixWorld).invert()
      camObj.copy(camera.position).applyMatrix4(inverse).multiplyScalar(scale)
      gObj.set(0, -1, 0).applyMatrix4(new THREE.Matrix4().copy(rotation).transpose()).normalize()
      const at = (t: number, k: number): number => (src.index ? src.index[t * 3 + k] : t * 3 + k)
      const reach = geometryRange + 0.03
      for (let t = 0; t < src.triangles; t++) {
        const dx = src.centroids[t * 3] * scale - camObj.x
        const dy = src.centroids[t * 3 + 1] * scale - camObj.y
        const dz = src.centroids[t * 3 + 2] * scale - camObj.z
        const r = src.triRadius[t] * scale
        if (dx * dx + dy * dy + dz * dz > (reach + r) * (reach + r)) continue
        const ia = at(t, 0), ib = at(t, 1), ic = at(t, 2)
        pa.fromArray(src.positions, ia * 3).multiplyScalar(scale)
        pb.fromArray(src.positions, ib * 3).multiplyScalar(scale)
        pc.fromArray(src.positions, ic * 3).multiplyScalar(scale)
        na.fromArray(src.normals, ia * 3).normalize()
        nb.fromArray(src.normals, ib * 3).normalize()
        nc.fromArray(src.normals, ic * 3).normalize()
        const axes = new Set([dominantAxis(na), dominantAxis(nb), dominantAxis(nc)])
        for (const axis of axes) {
          const proj = (p: THREE.Vector3): [number, number] => (axis === 0 ? [p.y, p.z] : axis === 1 ? [p.z, p.x] : [p.x, p.y])
          const [au, av] = proj(pa), [bu, bv] = proj(pb), [cu, cv] = proj(pc)
          const det = (bv - cv) * (au - cu) + (cu - bu) * (av - cv)
          if (Math.abs(det) < 1e-14) continue
          for (let layer = 1; layer < beadLayers.length; layer++) {
            if (beadLayers[layer].maxMm < geometryMinMm) continue
            const cell = beadLayers[layer].cellMm / 1000
            const u0 = Math.floor(Math.min(au, bu, cu) / cell), u1 = Math.floor(Math.max(au, bu, cu) / cell)
            const v0 = Math.floor(Math.min(av, bv, cv) / cell), v1 = Math.floor(Math.max(av, bv, cv) / cell)
            if ((u1 - u0 + 1) * (v1 - v0 + 1) > 4000) continue
            for (let cy = v0; cy <= v1; cy++) {
              for (let cx = u0; cx <= u1; cx++) {
                const [hx, hy, hz] = surfHash3(cx, cy, axis * 4 + layer, bead.salt)
                if (hx >= maxDensity(beadLayers[layer])) continue
                const pu = (cx + 0.25 + 0.5 * hy) * cell, pv = (cy + 0.25 + 0.5 * hz) * cell
                const w0 = ((bv - cv) * (pu - cu) + (cu - bu) * (pv - cv)) / det
                const w1 = ((cv - av) * (pu - cu) + (au - cu) * (pv - cv)) / det
                const w2 = 1 - w0 - w1
                if (w0 < 0 || w1 < 0 || w2 < 0) continue
                n.set(0, 0, 0).addScaledVector(na, w0).addScaledVector(nb, w1).addScaledVector(nc, w2).normalize()
                if (dominantAxis(n) !== axis) continue
                const level = -n.dot(gObj)
                down.copy(gObj).addScaledVector(n, -gObj.dot(n))
                const slope = down.length()
                if (slope > 1e-4) down.divideScalar(slope)
                else down.set(n.y !== 0 ? 1 : 0, n.y !== 0 ? 0 : 1, 0).addScaledVector(n, -n.y).normalize()
                side.crossVectors(down, n).normalize()
                const drops = cellDrops(layer, cx, cy, axis, bead, level, slope)
                for (const drop of drops) {
                  if (drop.layer === 0 || drops[0].diameterMm < geometryMinMm) continue
                  const plane = new THREE.Vector3().addScaledVector(pa, w0).addScaledVector(pb, w1).addScaledVector(pc, w2)
                  center.copy(plane)
                  if (drop.lobe > 0) {
                    const du = drop.u - drops[0].u, dv = drop.v - drops[0].v
                    center.add(liftOffset(du, dv, axis, n))
                  }
                  objCenter.copy(center).divideScalar(scale)
                  if (src.edges.near(objCenter, (drop.radius * 1.25 + 0.0003) / scale)) continue
                  world.copy(objCenter).applyMatrix4(mesh.matrixWorld)
                  if (world.distanceTo(camera.position) > geometryRange) continue
                  if (swept(world, drop.radius)) continue
                  if (drop.diameterMm * 0.001 < angle * world.distanceTo(camera.position)) continue
                  if (!frustum.intersectsSphere(sphere.set(world, drop.radius * 3 + 0.004))) continue
                  const up = 1 + 1.1 * slope, dn = 1 + 0.2 * slope
                  const along = (drop.radius * (up + dn)) / 2
                  center.addScaledVector(down, (-drop.radius * (up - dn)) / 2)
                  basis.makeBasis(down.clone().multiplyScalar(along), n.clone().multiplyScalar(drop.height), side.clone().multiplyScalar(drop.radius))
                  basis.setPosition(center)
                  matrix.makeScale(1 / scale, 1 / scale, 1 / scale).premultiply(mesh.matrixWorld).multiply(basis)
                  if (this.count >= maxInstances) continue
                  this.place(bead.contactDegrees, drop.diameterMm < 1.6, matrix, used)
                  this.count++
                }
              }
            }
          }
        }
      }
    }
    for (const [key, list] of this.pools) {
      const n0 = used.get(key) ?? 0
      list.forEach((m, i) => {
        const c = Math.max(0, Math.min(chunk, n0 - i * chunk))
        m.count = c
        m.visible = c > 0
        m.instanceMatrix.needsUpdate = true
      })
    }
  }

  private place(contact: number, small: boolean, matrix: THREE.Matrix4, used: Map<string, number>): void {
    const key = `${contact}:${small}`
    const k = used.get(key) ?? 0
    used.set(key, k + 1)
    const list = this.pool(contact, small)
    const slot = Math.floor(k / chunk)
    while (list.length <= slot) {
      const m = new THREE.InstancedMesh(this.template(contact, small), this.lens(contact), chunk)
      m.frustumCulled = false
      m.layers.set(layers.cameraOnly)
      m.castShadow = false
      m.receiveShadow = true
      m.matrixAutoUpdate = false
      m.count = 0
      this.group.add(m)
      list.push(m)
    }
    list[slot].setMatrixAt(k % chunk, matrix)
  }
}

/**
 * The refraction of a cap is traced exactly against its sphere, in the cap's own frame with the height restored to the
 * spherical cap, so the drop shows the inverted world behind it and the panel under its foot, as a ball lens does.
 */
const lensVertex = /* glsl */ `
#ifdef USE_INSTANCING
  mat4 surfM = modelMatrix * instanceMatrix;
#else
  mat4 surfM = modelMatrix;
#endif
vec3 surfCamL = (inverse(surfM) * vec4(cameraPosition, 1.0)).xyz;
surfLensCam = vec3(surfCamL.x, surfCamL.y * SURF_CAP_HS, surfCamL.z);
surfLensPos = vec3(position.x, position.y * SURF_CAP_HS, position.z);
surfLensM0 = surfM[0].xyz;
surfLensM1 = surfM[1].xyz / SURF_CAP_HS;
surfLensM2 = surfM[2].xyz;
surfLensT = surfM[3].xyz;
`

const lensPars = /* glsl */ `
varying vec3 surfLensCam;
varying vec3 surfLensPos;
varying vec3 surfLensM0;
varying vec3 surfLensM1;
varying vec3 surfLensM2;
varying vec3 surfLensT;
`

const lensFragment = /* glsl */ `
{
  mat3 surfLin = mat3(surfLensM0, surfLensM1, surfLensM2);
  vec3 c = vec3(0.0, SURF_CAP_CY, 0.0);
  vec3 o = surfLensPos;
  vec3 d = normalize(o - surfLensCam);
  vec3 sn = normalize(o - c);
  if (dot(sn, d) > 0.0) sn = -sn;
  vec3 t = refract(d, sn, 1.0 / 1.333);
  float exitAt = max(-2.0 * dot(t, o - c), 0.0);
  float baseAt = t.y < -1e-5 ? -o.y / t.y : 1e9;
  vec3 seen = vec3(0.0);
  vec3 e = t;
  vec3 q = o + t * exitAt;
  float through = 1.0;
  if (baseAt < exitAt) {
    vec3 f = o + t * baseAt;
    vec3 w = surfLin * f + surfLensT;
    vec4 clip = projectionMatrix * viewMatrix * vec4(w, 1.0);
    // Water on clearcoat: a weak interface that turns into a mirror at grazing incidence.
    float graze = pow(1.0 - clamp(-t.y, 0.0, 1.0), 5.0);
    float mirror = 0.0035 + 0.9965 * graze;
    seen = (1.0 - mirror) * getTransmissionSample(clip.xy / clip.w * 0.5 + 0.5, 0.0, 1.333).rgb;
    through = mirror;
    e = vec3(t.x, -t.y, t.z);
    vec3 fc = f - c;
    float b = dot(e, fc);
    float s2 = -b + sqrt(max(b * b - dot(fc, fc) + SURF_CAP_R * SURF_CAP_R, 0.0));
    q = f + e * s2;
  }
  vec3 n2 = normalize(q - c);
  vec3 out2 = refract(e, -n2, 1.333);
  if (dot(out2, out2) < 0.5) {
    out2 = reflect(e, -n2);
    through *= 0.6;
  }
  vec3 dirW = normalize(surfLin * out2);
  #ifdef USE_ENVMAP
    vec3 dirV = normalize((viewMatrix * vec4(dirW, 0.0)).xyz);
    vec3 side = normalize(abs(dirV.y) < 0.9 ? cross(dirV, vec3(0.0, 1.0, 0.0)) : cross(dirV, vec3(1.0, 0.0, 0.0)));
    seen += through * getIBLRadiance(-dirV, side, 0.0);
  #endif
  float cosIn = clamp(dot(-d, sn), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - cosIn, 5.0);
  float meniscus = smoothstep(0.0, 0.08, surfLensPos.y / SURF_CAP_HS);
  totalDiffuse = seen * (1.0 - fresnel) * mix(0.25, 1.0, meniscus);
}
`

/** Standing drops show magenta in the wetness view and running water yellow green, so the rivulet can be found in a frame. */
function dropMaterial(uniforms: Record<string, THREE.IUniform>, contact: number | null, running = false): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.02, transmission: 1, ior: 1.333, thickness: 0.002, specularIntensity: 1, envMapIntensity: 1,
  })
  const theta = THREE.MathUtils.degToRad(contact ?? 90)
  const radius = 1 / Math.sin(theta)
  patchMaterial(material, {
    id: contact === null ? 'surface water drop' : `surface water drop lens ${contact}`,
    uniforms: { ...uniforms, surfDiagColor: { value: running ? new THREE.Color(0.6, 1, 0.1) : new THREE.Color(1, 0.1, 0.9) } },
    defines: contact === null ? {} : { SURF_CAP_LENS: 1, SURF_CAP_HS: (radius * (1 - Math.cos(theta))).toFixed(6), SURF_CAP_CY: (-radius * Math.cos(theta)).toFixed(6), SURF_CAP_R: radius.toFixed(6) },
    apply(shader) {
      if (contact !== null) {
        shader.vertexShader = lensPars + insertAfter(shader.vertexShader, '#include <project_vertex>', lensVertex)
        let f = lensPars + 'uniform float surfDiag;\nuniform vec3 surfDiagColor;\n' + shader.fragmentShader
        f = insertAfter(f, '#include <transmission_fragment>', lensFragment)
        f = insertAfter(f, '#include <opaque_fragment>', 'if (surfDiag > 0.5) { gl_FragColor = vec4(surfDiagColor, 1.0); }')
        shader.fragmentShader = f
      } else {
        shader.fragmentShader = insertAfter('uniform float surfDiag;\nuniform vec3 surfDiagColor;\n' + shader.fragmentShader, '#include <opaque_fragment>', 'if (surfDiag > 0.5) { gl_FragColor = vec4(surfDiagColor, 1.0); }')
      }
    },
  })
  patchFilmLighting(material)
  return material
}

function liftOffset(du: number, dv: number, axis: number, n: THREE.Vector3): THREE.Vector3 {
  const o = axis === 0 ? new THREE.Vector3(0, du, dv) : axis === 1 ? new THREE.Vector3(dv, 0, du) : new THREE.Vector3(du, dv, 0)
  const na = axis === 0 ? n.x : axis === 1 ? n.y : n.z
  const lift = -o.dot(n) / na
  if (axis === 0) o.x = lift
  else if (axis === 1) o.y = lift
  else o.z = lift
  return o
}
