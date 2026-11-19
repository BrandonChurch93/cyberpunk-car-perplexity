import type { VehicleModule, VehicleOptions } from './contract'
import { createBlockout } from './blockout'

export type { Anchor, AnchorId, VehicleModule, VehicleOptions, VehicleState, WetnessKind } from './contract'

export async function createVehicle(options: VehicleOptions): Promise<VehicleModule> {
  return createBlockout(options)
}
