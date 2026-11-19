import * as THREE from 'three'
import { buildCity } from './city'
import type { WorldModule } from './contract'
import { buildDeck } from './deck'
import { loadLabels, roofFixtures } from './fixtures'
import { Forms, group } from './forms'
import { finishRoof } from './roof-look'

export async function createFullWorld(): Promise<WorldModule> {
  const labels = await loadLabels()
  const root = new THREE.Group()
  root.name = 'world'
  const roof = group(root, 'parking-garage')
  const city = group(root, 'city')
  const forms = new Forms()
  const deck = buildDeck(forms, roof)
  buildCity(forms, city)
  const surfaces = finishRoof(deck, roof)
  const cityColors = new Map<THREE.Material, THREE.Material>()
  city.traverse(o => {
    if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshStandardMaterial)) return
    let material = cityColors.get(o.material)
    if (!material) {
      const luminance = o.material.color.r
      material = new THREE.MeshStandardMaterial({ color: new THREE.Color(luminance * .235, luminance * .29, luminance * .35), roughness: .8 })
      cityColors.set(o.material, material)
    }
    o.material = material
    o.castShadow = false
    o.receiveShadow = false
  })
  const fixtures = roofFixtures(root, roof, city, labels, surfaces)
  const { min, max } = deck.bounds
  return {
    root,
    lights: fixtures.lights,
    signs: fixtures.signs,
    deck,
    reflectionBox: new THREE.Box3(new THREE.Vector3(min.x, 0, min.y), new THREE.Vector3(max.x, 81, max.y)),
    surfaces,
    steamSources: fixtures.steamSources,
    beginFrame: ({ frame }) => fixtures.set(frame.timeSeconds),
    beginSample: ({ timeSeconds }) => fixtures.set(timeSeconds),
  }
}
