import * as THREE from 'three'
import type { PaintSpec } from '../config'
import type { VehicleDetail } from './contract'

export interface Materials {
  paint: THREE.MeshPhysicalMaterial
  glass: THREE.MeshPhysicalMaterial
  shell: THREE.MeshStandardMaterial
  drl: THREE.MeshPhysicalMaterial
  tail: THREE.MeshPhysicalMaterial
  beamLens: THREE.MeshPhysicalMaterial
  housing: THREE.MeshStandardMaterial
  ceramic: THREE.MeshStandardMaterial
  soot: THREE.MeshStandardMaterial
  matte: THREE.MeshStandardMaterial
  covers: THREE.MeshStandardMaterial
  carbon: THREE.MeshPhysicalMaterial
  mesh: THREE.MeshStandardMaterial
  under: THREE.MeshStandardMaterial
  mirror: THREE.MeshPhysicalMaterial
  tire: THREE.MeshStandardMaterial
  rim: THREE.MeshStandardMaterial
  disc: THREE.MeshStandardMaterial
  hat: THREE.MeshStandardMaterial
  caliper: THREE.MeshStandardMaterial
  setLevels(running: number, beam: number, tail: number): void
  setPaint(paint: PaintSpec): void
}

const drlLuminance = 140
const tailLuminance = 40
const beamLuminance = 600

export async function makeMaterials(detail: VehicleDetail, paint: PaintSpec): Promise<Materials> {
  void detail
  void paint
  const std = (color: number, roughness: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, side: THREE.DoubleSide, ...extra })
  const phys = (color: number, roughness: number, extra: THREE.MeshPhysicalMaterialParameters = {}): THREE.MeshPhysicalMaterial =>
    new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, ...extra })
  const gray = 0x8c8f94
  const dark = 0x2b2c2f
  const darker = 0x1d1e20
  const m: Materials = {
    paint: phys(gray, 0.5),
    glass: phys(0x34373c, 0.2),
    shell: std(darker, 0.9),
    drl: phys(0xb9bcc0, 0.4, { emissive: new THREE.Color(0.86, 0.92, 1), emissiveIntensity: 0 }),
    tail: phys(0x3a3c40, 0.4, { emissive: new THREE.Color(1, 0.02, 0.01), emissiveIntensity: 0 }),
    beamLens: phys(0x55585c, 0.2, { emissive: new THREE.Color(1, 0.96, 0.9), emissiveIntensity: 0 }),
    housing: std(darker, 0.8),
    ceramic: std(dark, 0.7),
    soot: std(darker, 0.95),
    matte: std(dark, 0.85),
    covers: std(0x4a4c50, 0.6),
    carbon: phys(0x3c3e42, 0.5, { side: THREE.DoubleSide }),
    mesh: std(darker, 0.7),
    under: std(darker, 0.95),
    mirror: phys(0x4a4d52, 0.15),
    tire: std(0x232425, 0.9),
    rim: std(0x6f7277, 0.5),
    disc: std(0x55575a, 0.6),
    hat: std(0x3a3b3e, 0.6),
    caliper: std(0x5c5e62, 0.5),
    setLevels(running, beam, tail) {
      m.drl.emissiveIntensity = drlLuminance * running
      m.tail.emissiveIntensity = tailLuminance * tail
      m.beamLens.emissiveIntensity = beamLuminance * beam
    },
    setPaint() {},
  }
  return m
}
