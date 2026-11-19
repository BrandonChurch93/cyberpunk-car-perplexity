import { buildCity } from './city'
import type { WorldModule } from './contract'
import { buildDeck } from './deck'
import { Forms, group } from './forms'
import * as THREE from 'three'

export function createBlockoutWorld(): WorldModule {
  const root = new THREE.Group()
  root.name = 'world'
  const forms = new Forms()
  buildDeck(forms, group(root, 'parking-garage'))
  buildCity(forms, group(root, 'city'))
  return { root, signs: [], update: () => undefined }
}
