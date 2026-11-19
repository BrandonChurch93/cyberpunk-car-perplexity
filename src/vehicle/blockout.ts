import * as T from 'three'
import { config } from '../config'
import { events } from '../director/timeline'
import { createBody } from './body'
import { anchor, createEnds } from './ends'
import { createEngineBay } from './engine-bay'
import { tau } from './geometry'
import { palette } from './materials'
import { createWheels } from './wheels'
import type { VehicleModule, VehicleOptions, VehicleState } from './contract'

export async function createBlockout(options: VehicleOptions): Promise<VehicleModule> {
  const full = options.detail === 'full'
  const m = palette(options.paint, full)
  const root = new T.Group()
  root.name = 'vehicle'
  const sprung = new T.Group()
  sprung.name = 'sprung assembly'
  root.add(sprung)
  const { paintPoint, paintNormal } = createBody(sprung, m, full)
  const wheel = createWheels(root, m, full)
  const ends = createEnds(sprung, m, full)
  const detail = createEngineBay(sprung, m, full)
  const anchors: VehicleModule['anchors'] = {
    paint: anchor(paintPoint, paintNormal, .32),
    wheel: anchor(wheel, [1, 0, 0], .36),
    lamp: ends.lamp,
    detail,
    exhaust: ends.exhaust,
  }
  const update = (state: VehicleState): void => {
    const seconds = state.timeSeconds
    const elapsed = seconds - events.engineStart
    const rise = state.engine * Math.exp(-Math.pow((elapsed - .59) / .24, 2))
    ends.update(state.lampStage, rise)
    const phase = seconds / config.film.durationSeconds * tau
    const shake = state.vibration * .002
    sprung.position.y = shake * (.78 * Math.sin(phase * 923) + .22 * Math.sin(phase * 611))
    sprung.rotation.x = shake * .21 * Math.sin(phase * 419)
    sprung.rotation.z = shake * .29 * Math.sin(phase * 581)
  }
  await m.load()
  return { root, anchors, surfaces: m.surfaces, lamps: ends.lamps, heatSources: ends.heatSources, update, setPaint: m.setPaint }
}
