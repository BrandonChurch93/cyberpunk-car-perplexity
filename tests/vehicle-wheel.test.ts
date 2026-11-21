import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { defaultPaint, paintById } from '../src/config'
import { createVehicle, type VehicleModule, type WetnessKind } from '../src/vehicle'
import { mainLoft, dims } from '../src/vehicle/body/shape'
import { arches } from '../src/vehicle/body/cuts'
import type { Surface } from '../src/vehicle/geom/cuts'
import { makeMaterials } from '../src/vehicle/materials'
import { buildLiners } from '../src/vehicle/parts/liners'
import { buildWheel, buildWheels } from '../src/vehicle/parts/wheel'

function assertValidTangentUVs(g: THREE.BufferGeometry, label: string): void {
  const pos = g.getAttribute('position')
  const nrm = g.getAttribute('normal')
  const uv = g.getAttribute('uv')
  const idx = g.getIndex()
  expect(pos, `${label} position`).toBeDefined()
  expect(nrm, `${label} normal`).toBeDefined()
  expect(uv, `${label} uv`).toBeDefined()
  expect(idx, `${label} index`).not.toBeNull()
  const index = idx!
  expect(index.count % 3, `${label} tri count`).toBe(0)
  expect(index.count, `${label} non-empty`).toBeGreaterThan(0)

  const pa = new THREE.Vector3()
  const pb = new THREE.Vector3()
  const pc = new THREE.Vector3()
  const e1 = new THREE.Vector3()
  const e2 = new THREE.Vector3()
  const cr = new THREE.Vector3()
  const nv = new THREE.Vector3()
  const issues: string[] = []

  for (let v = 0; v < nrm.count && issues.length < 5; v++) {
    nv.fromBufferAttribute(nrm, v)
    const len = nv.length()
    if (!Number.isFinite(len) || Math.abs(len - 1) > 1e-3) {
      issues.push(`vtx ${v} non-unit normal len=${len}`)
    }
  }

  for (let i = 0; i < index.count && issues.length < 5; i += 3) {
    const ia = index.getX(i)
    const ib = index.getX(i + 1)
    const ic = index.getX(i + 2)
    pa.fromBufferAttribute(pos, ia)
    pb.fromBufferAttribute(pos, ib)
    pc.fromBufferAttribute(pos, ic)
    e1.subVectors(pb, pa)
    e2.subVectors(pc, pa)
    const area2 = cr.crossVectors(e1, e2).length()
    if (!(area2 > 1e-11)) issues.push(`tri ${i / 3} degenerate 3D area2=${area2}`)

    for (const v of [ia, ib, ic]) {
      nv.fromBufferAttribute(nrm, v)
      const len = nv.length()
      if (!Number.isFinite(len) || len < 0.95) issues.push(`tri ${i / 3} vtx ${v} invalid normal len=${len}`)
    }

    const ua = uv.getX(ia)
    const va = uv.getY(ia)
    const ub = uv.getX(ib)
    const vb = uv.getY(ib)
    const uc = uv.getX(ic)
    const vc = uv.getY(ic)
    const uvCross = Math.abs((ub - ua) * (vc - va) - (vb - va) * (uc - ua))
    if (!Number.isFinite(uvCross) || uvCross < 1e-11) issues.push(`tri ${i / 3} degenerate UV area2=${uvCross}`)
  }
  expect(issues, label).toEqual([])
}

describe('wheel, tire, brake and arch liner module', { timeout: 30_000 }, () => {
  let mainSurface: Surface
  let blockoutRoot: THREE.Group
  let fullRoot: THREE.Group
  let vehicleFull: VehicleModule

  beforeAll(async () => {
    const loft = mainLoft()
    mainSurface = (u, v) => loft.at(u, v)
    const paint = paintById(defaultPaint)

    const mBlock = await makeMaterials('blockout', paint)
    blockoutRoot = new THREE.Group()
    const sprungBlock = new THREE.Group()
    sprungBlock.name = 'sprung'
    blockoutRoot.add(sprungBlock)
    const tagBlock = (mat: THREE.Material, w: WetnessKind) => mBlock.tag(mat as THREE.MeshStandardMaterial, w)
    buildLiners(sprungBlock, mainSurface, { ...mBlock, tag: tagBlock }, false)
    buildWheels(blockoutRoot, { ...mBlock, tag: tagBlock }, false)
    blockoutRoot.updateMatrixWorld(true)

    const mFull = await makeMaterials('full', paint)
    fullRoot = new THREE.Group()
    const sprungFull = new THREE.Group()
    sprungFull.name = 'sprung'
    fullRoot.add(sprungFull)
    const tagFull = (mat: THREE.Material, w: WetnessKind) => mFull.tag(mat as THREE.MeshStandardMaterial, w)
    buildLiners(sprungFull, mainSurface, { ...mFull, tag: tagFull }, true)
    buildWheels(fullRoot, { ...mFull, tag: tagFull }, true)
    fullRoot.updateMatrixWorld(true)

    vehicleFull = await createVehicle({ paint, detail: 'full' })
    vehicleFull.root.updateMatrixWorld(true)
  }, 240_000)

  it('gives every wheel and liner triangle a non-degenerate UV frame for anisotropic beauty', () => {
    for (const [label, root] of [
      ['blockout', blockoutRoot],
      ['full', fullRoot],
    ] as const) {
      let meshCount = 0
      root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        meshCount++
        assertValidTangentUVs(o.geometry, `${label}:${o.parent?.name ?? ''}/${o.name}`)
      })
      expect(meshCount).toBeGreaterThan(20)
    }

    const legacy = buildWheel({
      radius: dims.frontTire.radius,
      width: dims.frontTire.width,
      rim: dims.frontTire.rim,
      disc: { radius: 0.205, thickness: 0.038 },
      flat: 0.0063,
      caliperAngle: Math.PI - 0.35,
      caliperLength: 1.0,
      quality: 1,
    })
    for (const [k, g] of Object.entries(legacy)) {
      if (g instanceof THREE.BufferGeometry) assertValidTangentUVs(g, `buildWheel:${k}`)
    }
  })

  it('joins Y-spoke branches cleanly into the rim while keeping pentagon and triangle windows open to the brake', () => {
    const clayFrontSide = new THREE.MeshStandardMaterial({ side: THREE.FrontSide })
    for (const root of [blockoutRoot, fullRoot]) {
      const fl = root.getObjectByName('wheel-front-left')!
      const rimTarget = new THREE.Group()
      const brakeTarget = new THREE.Group()
      fl.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        const clone = new THREE.Mesh(o.geometry, clayFrontSide)
        clone.applyMatrix4(o.matrixWorld)
        clone.updateMatrixWorld(true)
        if (['spoke-web', 'spoke-recess', 'spoke-chamfer', 'rim-barrel', 'rim-flange', 'hub-bowl', 'rim', 'lug-bolts'].includes(o.name)) {
          rimTarget.add(clone)
        } else if (['disc', 'disc-vents', 'disc-hat', 'caliper'].includes(o.name)) {
          brakeTarget.add(clone)
        }
      })

      const ray = new THREE.Raycaster()
      const dir = new THREE.Vector3(-1, 0, 0)
      const theta0 = 1.18
      const rJoin = 0.91 * dims.frontTire.rim

      for (let k = 0; k < 5; k++) {
        const th = theta0 + (k / 5) * Math.PI * 2
        for (const sign of [-1, 1]) {
          const a = th + sign * 0.42
          const y = 0.3405 + Math.cos(a) * rJoin
          const z = dims.frontHubZ + Math.sin(a) * rJoin
          ray.set(new THREE.Vector3(2.0, y, z), dir)
          expect(ray.intersectObjects(rimTarget.children, false).length).toBeGreaterThan(0)
        }

        const aPent = th + Math.PI / 5
        const yPent = 0.3405 + Math.cos(aPent) * (0.62 * dims.frontTire.rim)
        const zPent = dims.frontHubZ + Math.sin(aPent) * (0.62 * dims.frontTire.rim)
        ray.set(new THREE.Vector3(2.0, yPent, zPent), dir)
        expect(ray.intersectObjects(rimTarget.children, false).length).toBe(0)
        expect(ray.intersectObjects(brakeTarget.children, false).length).toBeGreaterThan(0)
      }
    }
    clayFrontSide.dispose()
  })

  it('flattens the loaded tire at y = 0 with lower sidewall bulge, outward normals and rotor edge vanes', () => {
    const fl = fullRoot.getObjectByName('wheel-front-left')!
    const tireMesh = fl.getObjectByName('tire') as THREE.Mesh
    const pos = tireMesh.geometry.getAttribute('position')
    const nrm = tireMesh.geometry.getAttribute('normal')
    const p = new THREE.Vector3()
    const n = new THREE.Vector3()
    const center = new THREE.Vector3(dims.frontHubX, 0.3405, dims.frontHubZ)
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(tireMesh.matrixWorld)

    let minY = Infinity
    let maxLowerHalfWidth = 0
    let maxUpperHalfWidth = 0
    let outwardCount = 0
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(tireMesh.matrixWorld)
      n.fromBufferAttribute(nrm, i).applyMatrix3(normalMatrix).normalize()
      minY = Math.min(minY, p.y)
      const halfW = Math.abs(p.x - dims.frontHubX)
      if (p.y > 0.015 && p.y < 0.08 && Math.abs(p.z - dims.frontHubZ) < 0.06) {
        maxLowerHalfWidth = Math.max(maxLowerHalfWidth, halfW)
      }
      if (p.y > 0.6 && Math.abs(p.z - dims.frontHubZ) < 0.06) {
        maxUpperHalfWidth = Math.max(maxUpperHalfWidth, halfW)
      }
      if (p.clone().sub(center).dot(n) > 0) outwardCount++
    }
    expect(Math.abs(minY)).toBeLessThan(0.0012)
    expect(maxLowerHalfWidth - maxUpperHalfWidth).toBeGreaterThan(0.007)
    expect(outwardCount / pos.count).toBeGreaterThan(0.92)

    const discMesh = fl.getObjectByName('disc') as THREE.Mesh
    expect(discMesh.geometry.getIndex()!.count / 3).toBeGreaterThan(1500)
    expect(fl.getObjectByName('sidewall-relief')).toBeInstanceOf(THREE.Mesh)
  })

  it('closes both front and rear wheelhouses in FrontSide clay and thickens the arch lips inside the body skin', () => {
    const clayFrontSide = new THREE.MeshStandardMaterial({ side: THREE.FrontSide })
    const sprung = fullRoot.getObjectByName('sprung')!
    const linerTargets: THREE.Mesh[] = []
    sprung.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const clone = new THREE.Mesh(o.geometry, clayFrontSide)
      clone.name = o.name
      clone.applyMatrix4(o.matrixWorld)
      clone.updateMatrixWorld(true)
      linerTargets.push(clone)
    })

    const ray = new THREE.Raycaster()
    for (const [front, zc, yc, rSample] of [
      [true, dims.frontHubZ, dims.frontTire.radius, 0.34],
      [false, dims.rearHubZ, dims.rearTire.radius, 0.36],
    ] as const) {
      const axle = front ? 'front' : 'rear'
      const lipMesh = sprung.getObjectByName(`arch-lip-${axle}-left`) as THREE.Mesh
      const linerMesh = sprung.getObjectByName(`liner-${axle}-left`) as THREE.Mesh
      const lipBox = new THREE.Box3().setFromBufferAttribute(lipMesh.geometry.getAttribute('position') as THREE.BufferAttribute)
      expect(lipBox.max.x - lipBox.min.x).toBeGreaterThan(0.015)

      const linerPos = linerMesh.geometry.getAttribute('position')
      for (let i = 0; i < linerPos.count; i++) {
        const y = linerPos.getY(i)
        const z = linerPos.getZ(i)
        expect(y).toBeGreaterThanOrEqual(0.12)
        if (y > 0.16) {
          expect(arches([0.95, y, z])).toBeGreaterThan(-0.002)
        }
      }

      for (const side of [1, -1] as const) {
        const dir = new THREE.Vector3(-side, 0, 0)
        const thMin = front ? -0.25 : 0.72
        const thMax = Math.PI + 0.25
        for (let k = 0; k <= 12; k++) {
          const theta = thMin + ((thMax - thMin) * k) / 12
          const y = Math.max(0.16, yc + Math.sin(theta) * rSample)
          const z = zc - Math.cos(theta) * rSample
          ray.set(new THREE.Vector3(side * 2.0, y, z), dir)
          const hits = ray.intersectObjects(linerTargets, false)
          expect(hits.length, `${axle} side=${side} k=${k}`).toBeGreaterThan(0)
        }
      }
    }
    clayFrontSide.dispose()
  })

  it('keeps Pass 2 wheel and liner triangle count under budget and rear liner clear of intake throat and exposed rear tread', () => {
    let moduleTris = 0
    fullRoot.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const idx = o.geometry.getIndex()!
      moduleTris += idx.count / 3
    })
    expect(moduleTris).toBeLessThanOrEqual(210_000)

    const rearLeftLiner = fullRoot.getObjectByName('liner-rear-left') as THREE.Mesh
    const pos = rearLeftLiner.geometry.getAttribute('position')
    let minX = Infinity
    let maxZ = -Infinity
    let behindLowCount = 0
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z = pos.getZ(i)
      minX = Math.min(minX, x)
      maxZ = Math.max(maxZ, z)
      if (y < 0.56 && x > 0.68 && z < dims.rearHubZ) behindLowCount++
    }
    expect(minX).toBeGreaterThan(0.625)
    expect(maxZ).toBeLessThan(-1.03)
    expect(behindLowCount).toBe(0)
  })

  it('covers left and right wheels in FrontSide clay on the assembled vehicle and keeps the wheel anchor in place', () => {
    const clayFrontSide = new THREE.MeshStandardMaterial({ side: THREE.FrontSide })
    const ray = new THREE.Raycaster()
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? 1 : -1
      const group = vehicleFull.root.getObjectByName(`wheel-front-${side}`)!
      expect(group).toBeDefined()
      const targets: THREE.Mesh[] = []
      group.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        assertValidTangentUVs(o.geometry, `vehicle-${side}:${o.name}`)
        const clone = new THREE.Mesh(o.geometry, clayFrontSide)
        clone.applyMatrix4(o.matrixWorld)
        clone.updateMatrixWorld(true)
        targets.push(clone)
      })
      ray.set(new THREE.Vector3(sign * 2.0, 0.3405 + 0.31, dims.frontHubZ), new THREE.Vector3(-sign, 0, 0))
      expect(ray.intersectObjects(targets, false).length, `${side} tire clay hit`).toBeGreaterThan(0)
    }
    expect(Math.abs(vehicleFull.anchors.wheel.position.x - 0.9563)).toBeLessThan(0.008)
    clayFrontSide.dispose()
  })

  it('gives full wheels dark spokes with machined chamfers, dark steel rotors, crimson calipers and wet sidewall cordons', () => {
    const fl = vehicleFull.root.getObjectByName('wheel-front-left')!
    const spokeWeb = fl.getObjectByName('spoke-web') as THREE.Mesh
    const spokeRecess = fl.getObjectByName('spoke-recess') as THREE.Mesh
    const spokeChamfer = fl.getObjectByName('spoke-chamfer') as THREE.Mesh
    const rimFlange = fl.getObjectByName('rim-flange') as THREE.Mesh
    const centerCap = fl.getObjectByName('rim') as THREE.Mesh
    const disc = fl.getObjectByName('disc') as THREE.Mesh
    const caliper = fl.getObjectByName('caliper') as THREE.Mesh
    const tire = fl.getObjectByName('tire') as THREE.Mesh
    const sidewallRelief = fl.getObjectByName('sidewall-relief') as THREE.Mesh

    const webMat = spokeWeb.material as THREE.MeshPhysicalMaterial
    const recessMat = spokeRecess.material as THREE.MeshPhysicalMaterial
    const chamferMat = spokeChamfer.material as THREE.MeshPhysicalMaterial
    const flangeMat = rimFlange.material as THREE.MeshPhysicalMaterial
    const capMat = centerCap.material as THREE.MeshPhysicalMaterial
    const discMat = disc.material as THREE.MeshPhysicalMaterial
    const caliperMat = caliper.material as THREE.MeshPhysicalMaterial
    const tireMat = tire.material as THREE.MeshPhysicalMaterial
    const sidewallMat = sidewallRelief.material as THREE.MeshPhysicalMaterial
    const rearLip = vehicleFull.root.getObjectByName('arch-lip-rear-left') as THREE.Mesh
    const rearLiner = vehicleFull.root.getObjectByName('liner-rear-left') as THREE.Mesh
    const rearLipMat = rearLip.material as THREE.MeshPhysicalMaterial
    const rearLinerMat = rearLiner.material as THREE.MeshPhysicalMaterial

    expect(webMat.color.r).toBeLessThan(0.02)
    expect(webMat.clearcoat).toBeGreaterThan(0.8)
    expect(recessMat.color.r).toBeLessThan(0.02)
    expect(capMat.color.r).toBeLessThan(0.02)
    expect(chamferMat.metalness).toBeGreaterThan(0.7)
    expect(flangeMat.metalness).toBeGreaterThan(0.75)
    expect(discMat.metalness).toBeGreaterThan(0.8)
    expect(discMat.color.r).toBeLessThan(0.06)
    expect(caliperMat.color.r).toBeGreaterThan(caliperMat.color.g * 3)
    expect(tireMat.clearcoat).toBeGreaterThan(0.75)
    expect(sidewallMat.clearcoat).toBeGreaterThan(0.7)
    expect(sidewallMat.color.r).toBeLessThan(0.02)
    expect(rearLipMat.clearcoat).toBeGreaterThan(0.85)
    expect(rearLinerMat.clearcoat).toBeGreaterThan(0.8)
  })
})
