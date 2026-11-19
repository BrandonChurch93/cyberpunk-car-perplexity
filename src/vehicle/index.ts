import type { VehicleModule, VehicleOptions } from './contract'
import { createModeled } from './modeled'

export type { Anchor, AnchorId, VehicleModule, VehicleOptions, VehicleState, WetnessKind } from './contract'

export async function createVehicle(options: VehicleOptions): Promise<VehicleModule> {
  return createModeled(options)
}
