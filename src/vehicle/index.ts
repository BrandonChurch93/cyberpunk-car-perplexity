import type { VehicleModule, VehicleOptions } from './contract'
import { buildVehicle } from './vehicle'

export type { Anchor, AnchorId, VehicleModule, VehicleOptions, VehicleState, WetnessKind } from './contract'

export async function createVehicle(options: VehicleOptions): Promise<VehicleModule> {
  return buildVehicle(options)
}
