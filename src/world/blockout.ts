import * as THREE from 'three'
import { buildCity } from './city'
import type { WorldModule } from './contract'
import { buildDeck } from './deck'
import { Forms, group } from './forms'

export function createBlockoutWorld(): WorldModule {
  const root = new THREE.Group()
  root.name = 'world'
  const forms = new Forms()
  const deck = buildDeck(forms, group(root, 'parking-garage'))
  buildCity(forms, group(root, 'city'))
  const { min, max } = deck.bounds
  return {
    root,
    lights: [],
    signs: [],
    deck,
    reflectionBox: new THREE.Box3(new THREE.Vector3(min.x, 0, min.y), new THREE.Vector3(max.x, 80, max.y)),
    surfaces: [],
    beginFrame: () => undefined,
    beginSample: () => undefined,
  }
}
