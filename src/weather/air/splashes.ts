import * as THREE from 'three'
import { config, shutterSeconds } from '../../config'
import type { FrameContext } from '../../core/contract'
import { hash01 } from '../../core/random'
import type { WeatherDeps } from '../contract'
import { ImpactSurfaces, type ImpactSurfacePoint } from './impact-surfaces'
import { impactCellMeters, impactForCell, impactPeriodSeconds, impactsPerCellPeriod, type RainImpact } from './impacts'
import { prevailingWind } from './motion'
import { makeRibbonGeometry, type RibbonView } from './ribbons'

const airSplashRange = 20.5
const satelliteRange = 12.8
const crownDuration = 0.031
const flightDuration = 0.112
const bufferCapacity = 14_000
const sprayCapacity = 1600
const tau = Math.PI * 2
const gravity = 9.81

interface Splash extends RainImpact {
  surface: ImpactSurfacePoint['face']
  base: THREE.Vector3
  power: number
  priority: number
  vehicle: boolean
  satellite: number
}

type SplashDeps = {
  lights: WeatherDeps['lights']
  world: Pick<WeatherDeps['world'], 'root' | 'surfaces'>
  vehicle: Pick<WeatherDeps['vehicle'], 'root' | 'surfaces'>
}

export function sprayExposure(age: number, shutter: number, lifetime: number): { age: number; weight: number } {
  const start = Math.max(0, age - shutter / 2)
  const end = Math.min(lifetime, age + shutter / 2)
  if (end <= start) return { age: 0, weight: 0 }
  const cdf = (time: number) => {
    const u = time / lifetime
    return u * u * (3 - 2 * u)
  }
  return { age: (start + end) / 2, weight: (cdf(end) - cdf(start)) * lifetime / (1.5 * shutter) }
}

function upload(geometry: THREE.InstancedBufferGeometry, count: number): void {
  geometry.instanceCount = count
  if (!count) return
  for (const name of ['aDrop', 'aMotion']) {
    const a = geometry.getAttribute(name) as THREE.InstancedBufferAttribute
    a.clearUpdateRanges()
    a.addUpdateRange(0, count * 4)
    a.needsUpdate = true
  }
}

export class Splashes {
  readonly mesh: THREE.Mesh
  readonly spray: THREE.Mesh
  private readonly drops = new Float32Array(bufferCapacity * 4)
  private readonly velocities = new Float32Array(bufferCapacity * 4)
  private readonly geometry = makeRibbonGeometry(this.drops, this.velocities, true)
  private readonly sprayDrops = new Float32Array(sprayCapacity * 4)
  private readonly sprayMotion = new Float32Array(sprayCapacity * 4)
  private readonly sprayGeometry = makeRibbonGeometry(this.sprayDrops, this.sprayMotion, true)
  private readonly solid: ImpactSurfaces
  private readonly vehicle: ImpactSurfaces
  private readonly hits: Splash[] = []
  private readonly origin = new THREE.Vector3()
  private readonly yUp = new THREE.Vector3()
  private readonly side = new THREE.Vector3()
  private readonly across = new THREE.Vector3()
  private readonly direction = new THREE.Vector3()
  private readonly delta = new THREE.Vector3()
  private readonly start = new THREE.Vector3()
  private readonly end = new THREE.Vector3()
  private frameTime = 0
  private ribbons = 0

  constructor(deps: SplashDeps, view: RibbonView) {
    this.mesh = view.makeMesh(deps.lights, this.geometry, -1)
    this.mesh.name = 'rain-splash'
    this.spray = view.makeMesh(deps.lights, this.sprayGeometry, -2)
    this.spray.name = 'rain-body-spray'
    this.solid = new ImpactSurfaces(deps.world.root, deps.world.surfaces, 1.7)
    this.vehicle = new ImpactSurfaces(deps.vehicle.root, deps.vehicle.surfaces, 0.32)
  }

  beginFrame({ frame, camera, format }: FrameContext): void {
    this.frameTime = frame.frameKey / config.film.fps
    this.hits.length = 0
    const lowTime = this.frameTime - shutterSeconds / 2 - 0.225
    const recentTime = this.frameTime - shutterSeconds / 2 - flightDuration
    const highTime = this.frameTime + shutterSeconds / 2
    const firstSlot = Math.floor(lowTime * impactsPerCellPeriod / impactPeriodSeconds)
    const lastSlot = Math.floor(highTime * impactsPerCellPeriod / impactPeriodSeconds)
    const cx = camera.position.x
    const cz = camera.position.z
    const lowX = Math.floor((cx - airSplashRange) / impactCellMeters)
    const highX = Math.floor((cx + airSplashRange) / impactCellMeters)
    const lowZ = Math.floor((cz - airSplashRange) / impactCellMeters)
    const highZ = Math.floor((cz + airSplashRange) / impactCellMeters)
    const inverse = camera.quaternion.clone().invert()
    const view = new THREE.Vector3()
    const halfX = camera.sensorWidthMm / (2 * camera.focalMm)
    const halfY = halfX * format.height / format.width
    const surface = {} as ImpactSurfacePoint
    const vehicle = {} as ImpactSurfacePoint
    for (let x = lowX; x <= highX; x++) {
      for (let z = lowZ; z <= highZ; z++) {
        const d = Math.hypot((x + 0.5) * impactCellMeters - cx, (z + 0.5) * impactCellMeters - cz)
        if (d > airSplashRange + impactCellMeters) continue
        for (let slot = firstSlot; slot <= lastSlot; slot++) {
          const period = Math.floor(slot / impactsPerCellPeriod)
          const hit = impactForCell(x, z, period, slot - period * impactsPerCellPeriod)
          if (hit.timeSeconds < lowTime || hit.timeSeconds > highTime) continue
          const strikeVehicle = this.vehicle.at(hit.x, hit.z, vehicle)
          if (!strikeVehicle && (hit.timeSeconds < recentTime || hit.diameter < THREE.MathUtils.lerp(0.0022, 0.00252, THREE.MathUtils.smoothstep(d, 9, airSplashRange)))) continue
          const strikeWorld = this.solid.at(hit.x, hit.z, surface)
          if (!strikeWorld && !strikeVehicle) continue
          const onVehicle = strikeVehicle && (!strikeWorld || vehicle.y > surface.y)
          const selected = onVehicle ? vehicle : surface
          const distance = Math.hypot(hit.x - cx, selected.y - camera.position.y, hit.z - cz)
          const strength = onVehicle ? 1 - THREE.MathUtils.smoothstep(distance, 8.5, 16) : 1 - THREE.MathUtils.smoothstep(distance, 8, airSplashRange)
          if (strength < 0.005) continue
          const base = new THREE.Vector3(hit.x, selected.y, hit.z)
          view.copy(base).sub(camera.position).applyQuaternion(inverse)
          const depth = -view.z
          const margin = 0.26 + Math.max(depth, 0) * 0.055
          const inView = depth > -margin && Math.abs(view.x) < depth * halfX + margin && Math.abs(view.y) < depth * halfY + margin
          if (onVehicle) base.applyMatrix4(selected.face.inverse)
          const satellite = onVehicle ? 1 : 1 - THREE.MathUtils.smoothstep(distance, 7, satelliteRange)
          const priority = strength + (onVehicle ? 2 : inView ? 1 : 0)
          this.hits.push({ ...hit, base, surface: selected.face, power: strength, priority, vehicle: onVehicle, satellite })
        }
      }
    }
    this.hits.sort((a, b) => b.priority - a.priority)
    this.update()
    this.updateSpray()
  }

  private write(width: number, gain: number): void {
    if (this.ribbons >= bufferCapacity || gain < 0.002) return
    const n = this.ribbons++ * 4
    this.delta.subVectors(this.end, this.start)
    this.drops[n] = (this.start.x + this.end.x) * 0.5
    this.drops[n + 1] = (this.start.y + this.end.y) * 0.5
    this.drops[n + 2] = (this.start.z + this.end.z) * 0.5
    this.drops[n + 3] = width
    this.velocities[n] = this.delta.x
    this.velocities[n + 1] = this.delta.y
    this.velocities[n + 2] = this.delta.z
    this.velocities[n + 3] = gain
  }

  private update(): void {
    this.ribbons = 0
    for (const mesh of this.vehicle.meshes) mesh.updateWorldMatrix(true, false)
    for (const hit of this.hits) {
      const age = this.frameTime - hit.timeSeconds
      if (age < -shutterSeconds / 2 || age > flightDuration + shutterSeconds / 2) continue
      if (hit.vehicle && hit.diameter < 0.00172) continue
      if (age >= crownDuration + shutterSeconds / 2 && hit.satellite < 0.005) continue
      this.origin.copy(hit.base)
      if (hit.vehicle) this.origin.applyMatrix4(hit.surface.mesh.matrixWorld)
      this.yUp.copy(hit.surface.up)
      this.origin.addScaledVector(this.yUp, 0.0012)
      this.side.set(this.yUp.y, -this.yUp.x, 0).normalize()
      this.across.crossVectors(this.yUp, this.side)
      const spin = hash01(hit.seed, 4) * tau
      const size = (hit.diameter * 1000 - 1) / 2
      const sizeVariation = 0.75 + 0.35 * hash01(hit.seed, 5)
      const crown = sprayExposure(age, shutterSeconds, crownDuration)
      if (crown.weight > 0.002) {
        const u = crown.age / crownDuration
        const edge = 0.0048 + (0.004 + size * 0.007) * u * sizeVariation
        const height = (0.007 + 0.014 * size) * Math.sin(u * Math.PI * 0.82) * sizeVariation
        const deckContrast = hit.vehicle ? 1 : 1.25 + size * 0.45
        const gain = hit.power * (0.48 + 0.52 * size) * crown.weight * deckContrast
        const cusps = hit.power < 0.65 ? 3 : size > 0.75 ? 7 : 5
        for (let i = 0; i < cusps; i++) {
          const angle = spin + (i / cusps) * tau
          const irregularity = 0.7 + 0.42 * hash01(hit.seed, 6, i)
          this.direction.copy(this.side).multiplyScalar(Math.cos(angle)).addScaledVector(this.across, Math.sin(angle))
          this.start.copy(this.origin).addScaledVector(this.direction, edge * 0.55).addScaledVector(this.yUp, height * 0.1)
          this.end.copy(this.origin).addScaledVector(this.direction, edge * irregularity).addScaledVector(this.yUp, height * irregularity)
          this.write(0.0007 + size * 0.00045, gain * irregularity)
        }
      }
      const satellites = hit.satellite < 0.005 ? 0 : size > 0.79 ? 3 : 2
      for (let i = 0; i < satellites; i++) {
        const delay = 0.006 + 0.008 * hash01(hit.seed, 7, i)
        const flight = age - delay
        const launch = (0.53 + 0.41 * hash01(hit.seed, 8, i)) * sizeVariation
        const open = Math.max(0, flight - shutterSeconds / 2)
        const close = Math.min(flightDuration - delay, 2 * launch / gravity, flight + shutterSeconds / 2)
        if (close <= open) continue
        const scatter = (0.19 + 0.19 * hash01(hit.seed, 9, i)) * sizeVariation
        const angle = spin + ((i + 0.65 * hash01(hit.seed, 10, i)) / satellites) * tau
        const mid = (open + close) * 0.5
        const y = (launch - 0.5 * gravity * mid) * mid
        this.direction.copy(this.side).multiplyScalar(Math.cos(angle)).addScaledVector(this.across, Math.sin(angle))
        this.start.copy(this.origin).addScaledVector(this.direction, scatter * open)
        this.end.copy(this.origin).addScaledVector(this.direction, scatter * close)
        this.start.addScaledVector(this.yUp, (launch - 0.5 * gravity * open) * open)
        this.end.addScaledVector(this.yUp, (launch - 0.5 * gravity * close) * close)
        const fade = (1 - THREE.MathUtils.smoothstep(mid, 0.031, flightDuration - 0.009))
          * THREE.MathUtils.smoothstep(y, 0, 0.007) * ((close - open) / shutterSeconds)
        this.write(0.0007 + size * 0.00064, hit.power * hit.satellite * size * fade * 0.83)
      }
    }
    upload(this.geometry, this.ribbons)
  }

  private updateSpray(): void {
    let written = 0
    for (const hit of this.hits) {
      if (!hit.vehicle || written >= sprayCapacity) continue
      const slope = THREE.MathUtils.smoothstep(hit.surface.up.y, 0.39, 0.82)
      if (slope < 0.005) continue
      const size = (hit.diameter * 1000 - 1) * 0.5
      const lifetime = 0.146 + 0.079 * hash01(hit.seed, 11)
      const exposure = sprayExposure(this.frameTime - hit.timeSeconds, shutterSeconds, lifetime)
      if (exposure.weight < 0.006) continue
      const u = exposure.age / lifetime
      const rise = (0.027 + 0.071 * size) * Math.sin(u * Math.PI * 0.76)
      const bloom = 0.020 + 0.058 * u
      const normalMix = THREE.MathUtils.lerp(0.68, 0.45, slope)
      this.yUp.copy(hit.surface.up).multiplyScalar(normalMix).addScaledVector(THREE.Object3D.DEFAULT_UP, 1 - normalMix).normalize()
      this.origin.copy(hit.base).applyMatrix4(hit.surface.mesh.matrixWorld).addScaledVector(this.yUp, 0.013 + rise)
      const spin = hash01(hit.seed, 12) * tau
      const drift = u * (0.035 + 0.06 * hash01(hit.seed, 13))
      this.origin.x += drift * (0.48 * Math.cos(spin) + 0.42 * prevailingWind[0])
      this.origin.z += drift * (0.48 * Math.sin(spin) + 0.42 * prevailingWind[1])
      const n = written++ * 4
      this.sprayDrops.set([this.origin.x, this.origin.y, this.origin.z, bloom], n)
      this.sprayMotion.set([drift * 0.27 * prevailingWind[0], rise * 0.32, drift * 0.27 * prevailingWind[1], hit.power * slope * exposure.weight * (0.031 + 0.111 * size)], n)
    }
    upload(this.sprayGeometry, written)
  }
}
