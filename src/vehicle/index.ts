import * as THREE from 'three'
import { config } from '../config'
import { events, lampThresholds } from '../director/timeline'
import { createBodyPanels } from './body'
import type { Anchor, AnchorId, VehicleDetail, VehicleModule, VehicleOptions, VehicleState } from './contract'
import { FRONT_HUB_Z, FRONT_TIRE } from './dimensions'
import { createEngineBay } from './engine-bay'
import { createLampAssemblies } from './lamps'
import { createVehicleMaterials } from './materials'
import { createRearAssembly } from './rear'
import { smoothstep } from './surface'
import { createWheelAssemblies } from './wheels'

export type { Anchor, AnchorId, VehicleDetail, VehicleModule, VehicleOptions, VehicleState, WetnessKind } from './contract'

function makeAnchor(position: [number, number, number], normal: [number, number, number], radius: number): Anchor {
  return {
    position: new THREE.Vector3(...position),
    normal: new THREE.Vector3(...normal).normalize(),
    radius,
  }
}

export async function createVehicle(options: VehicleOptions): Promise<VehicleModule> {
  const detail = options.detail
  const materials = await createVehicleMaterials(detail, options.paint)

  const root = new THREE.Group()
  root.name = 'vehicle'

  const sprung = new THREE.Group()
  sprung.name = 'vehicle-sprung'

  const body = createBodyPanels(materials, detail)
  const engineBay = createEngineBay(materials, detail)
  const rear = createRearAssembly(materials, detail)
  const lampRig = createLampAssemblies(materials, detail)

  sprung.add(body, engineBay, rear.group, lampRig.group)
  const wheels = createWheelAssemblies(materials, detail)
  root.add(sprung, wheels)

  const anchors: Record<AnchorId, Anchor> = {
    paint: makeAnchor([0.785, 0.812, 1.28], [0.58, 0.8, 0.14], 0.34),
    wheel: makeAnchor([FRONT_TIRE.outboardX, FRONT_TIRE.radius - 0.004, FRONT_HUB_Z], [1, 0, 0], 0.35),
    lamp: makeAnchor([0.705, 0.545, 2.055], [0.52, 0.16, 0.84], 0.22),
    detail: makeAnchor([0, 0.985, -1.12], [0, 0.98, -0.2], 0.48),
    exhaust: makeAnchor([0, 0.795, -2.445], [0, 0, -1], 0.28),
  }

  const duration = config.film.durationSeconds
  const omegaBase = (Math.PI * 2) / duration
  const kRoll = Math.round(13.5 * duration)
  const kHeave = Math.round(27.0 * duration)
  const kPitch = Math.round(19.0 * duration)

  const update = (state: VehicleState): void => {
    const t = state.timeSeconds
    const drlLevel = smoothstep(lampThresholds.running, lampThresholds.running + 0.06, state.lampStage)
    const beamLevel = smoothstep(lampThresholds.beamStart, lampThresholds.beamFull, state.lampStage)

    const startKick = Math.exp(-Math.pow((t - (events.engineStart + 0.22)) / 0.38, 2))
    const brakeFlare = state.engine > 0.02 ? startKick * 0.85 : 0
    const tailLevel = Math.min(1, drlLevel * 0.72 + brakeFlare * 0.55)

    materials.drl.emissiveIntensity = drlLevel * (detail === 'full' ? 135 : 8)
    materials.projector.emissiveIntensity = (drlLevel * 0.08 + beamLevel * 0.92) * (detail === 'full' ? 280 : 14)
    materials.tailLight.emissiveIntensity = (drlLevel + brakeFlare * 1.15) * (detail === 'full' ? 42 : 6)
    materials.thirdBrake.emissiveIntensity = brakeFlare * (detail === 'full' ? 68 : 8)

    for (const lamp of lampRig.lamps) {
      if (lamp.beam) {
        lamp.level = beamLevel
      } else if (lamp.object.name.includes('tail')) {
        lamp.level = tailLevel
      } else {
        lamp.level = drlLevel
      }
    }

    const vib = state.vibration
    const heave = vib * 0.00085 * Math.sin(omegaBase * kHeave * t)
    const roll = vib * 0.0014 * Math.sin(omegaBase * kRoll * t + 0.4)
    const pitch = vib * 0.00045 * Math.sin(omegaBase * kPitch * t + 1.1)
    sprung.position.set(0, heave, 0)
    sprung.rotation.set(pitch, 0, roll)
  }

  update({ timeSeconds: 0, lampStage: 0, engine: 0, vibration: 0 })

  return {
    root,
    anchors,
    surfaces: materials.surfaces,
    lamps: lampRig.lamps,
    heatSources: rear.heatSources,
    update,
    setPaint: materials.setPaint,
  }
}
