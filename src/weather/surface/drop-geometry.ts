import * as THREE from 'three'
import type { CameraState } from '../../core/lens'
import { layers } from '../../core/contract'
import { insertAfter, patchMaterial, replaceOnce } from '../../materials/patch'
import { type BeadClass, beadLayers, cellDrops, dominantAxis, geometryMinMm } from './beads'
import { surfHash3 } from './hash'

/** Beyond this distance from the lens a drop is small enough on screen, and soft enough in focus, for the shader field. */
export const geometryRange = 1.1
const maxInstances = 24000
const chunk = 4096

interface Source {
  mesh: THREE.Mesh
  bead: BeadClass
  positions: Float32Array
  normals: Float32Array
  centroids: Float32Array
  triRadius: Float32Array
  triangles: number
  index: ArrayLike<number> | null
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
  private readonly sources: Source[] = []
  private readonly pools = new Map<string, THREE.InstancedMesh[]>()
  count = 0

  constructor(meshes: Array<{ mesh: THREE.Mesh; bead: BeadClass }>, uniforms: Record<string, THREE.IUniform>) {
    this.group.name = 'surface water drops'
    this.material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0, roughness: 0.02, transmission: 1, ior: 1.333, thickness: 0.002, specularIntensity: 1, envMapIntensity: 1,
    })
    patchMaterial(this.material, {
      id: 'surface water drop lens',
      uniforms,
      apply(shader) {
        shader.vertexShader = 'varying float surfDropH;\nvarying float surfDropScale;\n' + insertAfter(shader.vertexShader, '#include <project_vertex>', `
          #ifdef USE_INSTANCING
            surfDropScale = length(instanceMatrix[1].xyz);
          #else
            surfDropScale = 0.001;
          #endif
          surfDropH = position.y;`)
        const chunkText = THREE.ShaderChunk.transmission_fragment
        const lens = replaceOnce(
          replaceOnce(chunkText, 'material.thickness = thickness;', 'material.thickness = surfDropScale * (0.6 + 2.4 * surfDropH);'),
          'totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );',
          `float surfFacing = clamp(dot(n, v), 0.0, 1.0);
          float surfRim = mix(0.12, 1.0, smoothstep(0.08, 0.55, surfFacing));
          totalDiffuse = mix( totalDiffuse, transmitted.rgb * surfRim, material.transmission );`,
        )
        let f = 'varying float surfDropH;\nvarying float surfDropScale;\nuniform float surfDiag;\n' + shader.fragmentShader
        f = replaceOnce(f, '#include <transmission_fragment>', lens)
        f = insertAfter(f, '#include <opaque_fragment>', 'if (surfDiag > 0.5) { gl_FragColor = vec4(1.0, 0.1, 0.9, 1.0); }')
        shader.fragmentShader = f
      },
    })
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
      this.sources.push({ mesh, bead, positions, normals, centroids, triRadius, triangles, index })
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

  update(camera: CameraState, aspect: number): void {
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
    const center = new THREE.Vector3(), world = new THREE.Vector3()
    this.count = 0
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
                if (hx >= Math.max(beadLayers[layer].flat, beadLayers[layer].steep)) continue
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
                  world.copy(center).divideScalar(scale).applyMatrix4(mesh.matrixWorld)
                  if (world.distanceTo(camera.position) > geometryRange) continue
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
      const m = new THREE.InstancedMesh(this.template(contact, small), this.material, chunk)
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

function liftOffset(du: number, dv: number, axis: number, n: THREE.Vector3): THREE.Vector3 {
  const o = axis === 0 ? new THREE.Vector3(0, du, dv) : axis === 1 ? new THREE.Vector3(dv, 0, du) : new THREE.Vector3(du, dv, 0)
  const na = axis === 0 ? n.x : axis === 1 ? n.y : n.z
  const lift = -o.dot(n) / na
  if (axis === 0) o.x = lift
  else if (axis === 1) o.y = lift
  else o.z = lift
  return o
}
