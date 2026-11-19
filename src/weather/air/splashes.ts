import * as THREE from 'three'
import { config, shutterSeconds } from '../../config'
import type { FrameContext, SampleContext } from '../../core/contract'
import { hash01 } from '../../core/random'
import type { WeatherDeps } from '../contract'
import { ImpactSurfaces, type ImpactSurfacePoint } from './impact-surfaces'
import { impactCellMeters, impactForCell, impactPeriodSeconds, impactsPerCellPeriod, type RainImpact } from './impacts'
import { makeRibbonGeometry, type RibbonView } from './ribbons'

const airSplashRange = 10.5
const crownDuration = 0.031
const flightDuration = 0.112
const bufferCapacity = 14_000
const tau = Math.PI * 2
const gravity = 9.81

interface Splash extends RainImpact {
  surface: ImpactSurfacePoint['face']
  base: THREE.Vector3
  power: number
  vehicle: boolean
}

export class Splashes {
  readonly mesh: THREE.Mesh
  private readonly drops = new Float32Array(bufferCapacity * 4)
  private readonly velocities = new Float32Array(bufferCapacity * 4)
  private readonly geometry = makeRibbonGeometry(this.drops, this.velocities, true)
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

  constructor(deps: WeatherDeps, view: RibbonView) {
    this.mesh = view.makeMesh(deps.lights, this.geometry, -1)
    this.mesh.name = 'rain-splash'
    this.solid = new ImpactSurfaces(deps.world.root, deps.world.surfaces, 1.7)
    this.vehicle = new ImpactSurfaces(deps.vehicle.root, deps.vehicle.surfaces, 0.32)
  }

  beginFrame({ frame, camera }: FrameContext): void {
    this.frameTime = frame.frameKey / config.film.fps
    this.hits.length = 0
    const lowTime = this.frameTime - shutterSeconds / 2 - flightDuration
    const highTime = this.frameTime + shutterSeconds / 2
    const firstSlot = Math.floor(lowTime * impactsPerCellPeriod / impactPeriodSeconds)
    const lastSlot = Math.floor(highTime * impactsPerCellPeriod / impactPeriodSeconds)
    const cx = camera.position.x
    const cz = camera.position.z
    const lowX = Math.floor((cx - airSplashRange) / impactCellMeters)
    const highX = Math.floor((cx + airSplashRange) / impactCellMeters)
    const lowZ = Math.floor((cz - airSplashRange) / impactCellMeters)
    const highZ = Math.floor((cz + airSplashRange) / impactCellMeters)
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
          if (hit.diameter < (strikeVehicle ? 0.00172 : 0.0022)) continue
          const strikeWorld = this.solid.at(hit.x, hit.z, surface)
          if (!strikeWorld && !strikeVehicle) continue
          const onVehicle = strikeVehicle && (!strikeWorld || vehicle.y > surface.y)
          const selected = onVehicle ? vehicle : surface
          const distance = Math.hypot(hit.x - cx, selected.y - camera.position.y, hit.z - cz)
          const strength = 1 - THREE.MathUtils.smoothstep(distance, 6.2, airSplashRange)
          if (strength < 0.005) continue
          const base = new THREE.Vector3(hit.x, selected.y, hit.z)
          if (onVehicle) base.applyMatrix4(selected.face.inverse)
          this.hits.push({ ...hit, base, surface: selected.face, power: strength, vehicle: onVehicle })
        }
      }
    }
    this.update(this.frameTime)
  }

  beginSample({ sample }: SampleContext): void {
    this.update(this.frameTime + (sample.shutter - 0.5) * shutterSeconds)
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

  private update(time: number): void {
    this.ribbons = 0
    for (const mesh of this.vehicle.meshes) mesh.updateWorldMatrix(true, false)
    for (const hit of this.hits) {
      const age = time - hit.timeSeconds
      if (age < 0 || age > flightDuration) continue
      this.origin.copy(hit.base)
      if (hit.vehicle) this.origin.applyMatrix4(hit.surface.mesh.matrixWorld)
      this.yUp.copy(hit.surface.up)
      this.origin.addScaledVector(this.yUp, 0.0012)
      this.side.set(this.yUp.y, -this.yUp.x, 0).normalize()
      this.across.crossVectors(this.yUp, this.side)
      const spin = hash01(hit.seed, 4) * tau
      const size = (hit.diameter * 1000 - 1) / 2
      const sizeVariation = 0.75 + 0.35 * hash01(hit.seed, 5)
      if (age < crownDuration) {
        const u = age / crownDuration
        const edge = 0.0048 + (0.004 + size * 0.007) * u * sizeVariation
        const height = (0.007 + 0.014 * size) * Math.sin(u * Math.PI * 0.82) * sizeVariation
        const gain = hit.power * (0.48 + 0.52 * size) * Math.sin(u * Math.PI)
        const cusps = size > 0.75 ? 7 : 5
        for (let i = 0; i < cusps; i++) {
          const angle = spin + (i / cusps) * tau
          const irregularity = 0.7 + 0.42 * hash01(hit.seed, 6, i)
          this.direction.copy(this.side).multiplyScalar(Math.cos(angle)).addScaledVector(this.across, Math.sin(angle))
          this.start.copy(this.origin).addScaledVector(this.direction, edge * 0.55).addScaledVector(this.yUp, height * 0.1)
          this.end.copy(this.origin).addScaledVector(this.direction, edge * irregularity).addScaledVector(this.yUp, height * irregularity)
          this.write(0.0007 + size * 0.00045, gain * irregularity)
        }
      }
      const satellites = size > 0.79 ? 3 : 2
      for (let i = 0; i < satellites; i++) {
        const flight = age - (0.006 + 0.008 * hash01(hit.seed, 7, i))
        if (flight <= 0) continue
        const launch = (0.53 + 0.41 * hash01(hit.seed, 8, i)) * sizeVariation
        const scatter = (0.19 + 0.19 * hash01(hit.seed, 9, i)) * sizeVariation
        const angle = spin + ((i + 0.65 * hash01(hit.seed, 10, i)) / satellites) * tau
        const y = (launch - 0.5 * gravity * flight) * flight
        if (y < 0) continue
        const blur = Math.min(shutterSeconds * 0.29, flight * 0.48)
        this.direction.copy(this.side).multiplyScalar(Math.cos(angle)).addScaledVector(this.across, Math.sin(angle))
        this.start.copy(this.origin).addScaledVector(this.direction, scatter * (flight - blur))
        this.end.copy(this.origin).addScaledVector(this.direction, scatter * (flight + blur))
        this.start.addScaledVector(this.yUp, y - (launch - gravity * flight) * blur)
        this.end.addScaledVector(this.yUp, y + (launch - gravity * flight) * blur)
        const fade = (1 - THREE.MathUtils.smoothstep(flight, 0.031, flightDuration - 0.009)) * THREE.MathUtils.smoothstep(y, 0, 0.007)
        this.write(0.0007 + size * 0.00064, hit.power * size * fade * 0.83)
      }
    }
    this.geometry.instanceCount = this.ribbons
    for (const name of ['aDrop', 'aMotion']) {
      const a = this.geometry.getAttribute(name) as THREE.InstancedBufferAttribute
      a.clearUpdateRanges()
      if (this.ribbons > 0) a.addUpdateRange(0, this.ribbons * 4)
      if (this.ribbons > 0) a.needsUpdate = true
    }
  }
}
