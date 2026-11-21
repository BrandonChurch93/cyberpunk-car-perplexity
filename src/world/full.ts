import * as THREE from 'three'
import { config } from '../config'
import { buildCity } from './city'
import { cityPracticals } from './city-practicals'
import type { WorldModule } from './contract'
import { buildDeck } from './deck'
import { detailFacades } from './facades'
import { addSky, loadLabels, roofFixtures } from './fixtures'
import { Forms, group } from './forms'
import { addApprovedHeroLayout, approvedHeroSourceSurvey } from './hero-layout'
import { addReflectionFrontages } from './reflection-practicals'
import { addNorthSkyline } from './north'
import { finishRoof } from './roof-look'
import { articulateSouthTowers } from './tower-articulation'

const wake = config.beats.find(beat => beat.id === 'wake')!
const returnShot = config.beats.find(beat => beat.id === 'return')!

export async function createFullWorld(): Promise<WorldModule> {
  const labels = await loadLabels()
  const root = new THREE.Group()
  root.name = 'world'
  const roof = group(root, 'parking-garage')
  const city = group(root, 'city')
  const forms = new Forms()
  const deck = buildDeck(forms, roof)
  buildCity(forms, city, true)
  const { surfaces, materials } = finishRoof(deck, roof)
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
  const fixtures = roofFixtures(roof, city, labels, surfaces)
  const updateCity = cityPracticals(city, labels, fixtures.signs)
  detailFacades(city)
  const hero = addApprovedHeroLayout(root, labels, materials)
  articulateSouthTowers(root)
  const survey = approvedHeroSourceSurvey()
  const district = (id: string) => {
    const { at: [x,,z] } = survey.find(source=>source.id===id)!
    return new THREE.Vector2(x,z)
  }
  const northSkyline = addNorthSkyline(root,labels)
  addSky(root,[district('magenta violet tower screen'),district('left cyan facade sail')],hero.muralCloud,northSkyline.district)
  const reflections = addReflectionFrontages(root,labels)
  const optics = [...fixtures.lights, ...fixtures.wideLights].filter(light => light.kind === 'spot').map(light => ({ ...light }))
  const wideLights = new Map([...hero.lights,...fixtures.wideLights.map(light=>[light.id,light] as const)])
  const slots = fixtures.lights.map(original => {
    const wide = wideLights.get(original.id)
    return { original, wide, output: wide ? { ...wide } : original }
  })
  const set = (timeSeconds: number, cutTime = timeSeconds) => {
    const wide = cutTime < wake.end || cutTime >= returnShot.start
    fixtures.set(timeSeconds, cutTime, wide)
    updateCity(timeSeconds)
    hero.set(timeSeconds)
    reflections.update(timeSeconds)
    northSkyline.set(timeSeconds)
    for (const slot of slots) {
      if (!slot.wide) continue
      const source = wide ? slot.wide : slot.original
      Object.assign(slot.output, source, { id: slot.wide.id, colorAt: source.colorAt })
    }
  }
  set(0)
  const { min, max } = deck.bounds
  return {
    root,
    lights: slots.map(slot => slot.output),
    signs: [...new Set([...fixtures.signs, ...hero.signs, ...reflections.signs, ...northSkyline.signs])],
    deck,
    reflectionBox: new THREE.Box3(new THREE.Vector3(min.x, 0, min.y), new THREE.Vector3(max.x, 81, max.y)),
    surfaces,
    steamSources: fixtures.steamSources,
    optics,
    beginFrame: ({ frame }) => set(frame.timeSeconds),
    beginSample: ({ timeSeconds, sample }) => set(timeSeconds, sample?.frame.timeSeconds),
  }
}
