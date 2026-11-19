import * as THREE from 'three'
import { stream } from '../core/random'
import type { WorldModule } from './contract'

export function createBlockoutWorld(): WorldModule {
  const root = new THREE.Group()
  root.name = 'world'
  const concrete = new THREE.MeshStandardMaterial({ color: 0x70747a, roughness: 0.9 })
  const pale = new THREE.MeshStandardMaterial({ color: 0x9a9da3, roughness: 0.9 })
  const far = new THREE.MeshStandardMaterial({ color: 0x4b4f57, roughness: 1 })
  const box = (size: [number, number, number], position: [number, number, number], material: THREE.Material, turn = 0): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material)
    mesh.position.set(...position)
    mesh.rotation.y = turn
    mesh.castShadow = true
    mesh.receiveShadow = true
    root.add(mesh)
    return mesh
  }
  const deck = new THREE.Group()
  deck.rotation.y = THREE.MathUtils.degToRad(12)
  root.add(deck)
  const slab = new THREE.Mesh(new THREE.BoxGeometry(64, 0.5, 44), concrete)
  slab.position.y = -0.25
  slab.receiveShadow = true
  deck.add(slab)
  for (let i = -12; i <= 12; i++) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.004, 5), pale)
    line.position.set(i * 2.5, 0.002, -6)
    deck.add(line)
    const other = line.clone()
    other.position.z = 6.5
    deck.add(other)
  }
  const parapet = (size: [number, number, number], position: [number, number, number]): void => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(...size), concrete)
    wall.position.set(...position)
    wall.castShadow = true
    wall.receiveShadow = true
    deck.add(wall)
  }
  parapet([64, 1.1, 0.25], [0, 0.55, -22])
  parapet([64, 1.1, 0.25], [0, 0.55, 22])
  parapet([0.25, 1.1, 44], [-32, 0.55, 0])
  parapet([0.25, 1.1, 44], [32, 0.55, 0])
  const core = new THREE.Mesh(new THREE.BoxGeometry(6, 3.4, 5), concrete)
  core.position.set(15, 1.7, -18.5)
  core.castShadow = true
  deck.add(core)
  for (const [x, z] of [[-14, -12], [12, 10], [-10, 14], [22, -6]] as const) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 6, 12), pale)
    pole.position.set(x, 3, z)
    pole.castShadow = true
    deck.add(pole)
  }
  const rng = stream('blockout-city')
  for (let i = 0; i < 90; i++) {
    const angle = rng.next() * Math.PI * 2
    const distance = 55 + rng.next() * 160
    const w = 14 + rng.next() * 26
    const d = 14 + rng.next() * 26
    const h = 40 + rng.next() * 150
    box([w, h, d], [Math.sin(angle) * distance, h / 2 - 32, Math.cos(angle) * distance], far, rng.next() * Math.PI)
  }
  const billboard = box([14, 8, 0.6], [16, 16, -62], pale, -0.2)
  billboard.name = 'billboard'
  return { root, signs: [], update: () => undefined }
}
