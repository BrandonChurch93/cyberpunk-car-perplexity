import * as THREE from 'three'
import { streamSeed } from '../core/random'
import { insertAfter, patchMaterial } from '../materials/patch'
import type { DeckSurface } from './contract'
import { deckJoint } from './deck'

const basins = [
  [0.92, 3.13, 4.12, 1.38, 0.016, -0.16],
  [1.21, 1.64, 0.54, 0.44, 0.019, -0.31],
  [0.18, -3.71, 2.96, 1.08, 0.013, 0.31],
  [-4.8, 5.45, 1.95, 0.65, 0.008, 0.08],
  [7.12, -2.46, 2.1, 1.04, 0.011, 0.48],
  [4.08, 8.44, 2.63, 0.64, 0.009, -0.23],
  [-8.4, -9.1, 2.18, 1.1, 0.011, 0.21],
  [14.5, -9.7, 3.3, 1.4, 0.009, 0.08],
] as const
const deckSeed = streamSeed('world/deck/height') / 4294967296

export function deckHeight(x: number, z: number): number {
  let y = 0.011 + 0.0016 * Math.sin(x * 0.86 + z * 0.41 + deckSeed * 6) + 0.0014 * Math.sin(x * -0.69 + z * 1.14)
  for (const [cx, cz, a, b, drop, slant] of basins) {
    const u = (x - cx + (z - cz) * slant) / a
    const v = (z - cz - (x - cx) * slant) / b
    const r = u * u + v * v
    if (r < 1) y -= drop * (1 - r) * (1 + 0.14 * Math.sin(9 * u + 7 * v) + 0.09 * Math.sin(19 * u - 13 * v))
  }
  const joint = Math.abs(z - deckJoint.z)
  if (joint < 0.14 && x > deckJoint.startX) y += 0.004 * (1 - joint / 0.14)
  return y
}

function relief(bounds: THREE.Box2): THREE.DataTexture {
  const size = 512
  const data = new Float32Array(size * size)
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, (i + 0.5) / size)
    const z = THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, (j + 0.5) / size)
    data[j * size + i] = deckHeight(x, z)
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.FloatType)
  texture.name = 'deck signed height in meters'
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

type Type = 'deck' | 'concrete' | 'zinc' | 'stripe'

const fields = /* glsl */ `
  varying vec3 vRoofWorld;
  uniform float roofSeed;
  float roofHash(vec2 p) {
    vec3 q = fract(vec3(p.xyx + roofSeed) * .1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
  float roofNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 w = f*f*(3.0-2.0*f);
    return mix(mix(roofHash(i),roofHash(i+vec2(1,0)),w.x),mix(roofHash(i+vec2(0,1)),roofHash(i+1.0),w.x),w.y);
  }
  float roofGrain(vec2 p) {
    vec2 rate = fwidth(p);
    return mix(roofNoise(p), .5, smoothstep(.32, 1.4, max(rate.x, rate.y)));
  }
`

function textureMaterial(material: THREE.MeshStandardMaterial, type: Type): void {
  patchMaterial(material, {
    id: `world-roof-${type}`,
    uniforms: { roofSeed: { value: streamSeed(`world/roof/${type}`) / 4294967296 * 37 } },
    defines: { ['ROOF_' + type.toUpperCase()]: 1 },
    apply(shader) {
      shader.vertexShader = insertAfter(shader.vertexShader, '#include <common>', 'varying vec3 vRoofWorld;')
      shader.vertexShader = insertAfter(shader.vertexShader, '#include <project_vertex>', /* glsl */ `
        vec4 roofLocal = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          roofLocal = instanceMatrix * roofLocal;
        #endif
        vRoofWorld = (modelMatrix * roofLocal).xyz;
      `)
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <common>', fields)
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <color_fragment>', /* glsl */ `
        vec2 roofP = vRoofWorld.xz;
        float roofFine = roofGrain(roofP * 79.0);
        float roofMottle = roofNoise(roofP * 3.1);
        #ifdef ROOF_DECK
          float patchSide = max(abs(roofP.x + 2.45) / 2.35, abs(roofP.y - 5.13 + roofP.x*.13) / .87);
          float patchInside = 1.0 - smoothstep(.97, 1.0, patchSide + roofFine*.038);
          float scuff = 0.0;
          float scuffLine = roofP.x + .52 - .16*roofP.y*roofP.y;
          scuff += (1.0-smoothstep(.11,.33,abs(scuffLine))) * (1.0-smoothstep(1.0,3.0,abs(roofP.y-2.5)));
          scuff += (1.0-smoothstep(.16,.34,abs(scuffLine+1.38))) * (1.0-smoothstep(1.0,3.0,abs(roofP.y-2.5)));
          float oil = (1.0-smoothstep(.16,.9,length((roofP-vec2(.45,-.53))*vec2(2.1,1.0)) + .24*roofMottle));
          float repairs = .89 + .19 * patchInside - scuff*.24 - oil*.34;
          diffuseColor.rgb *= repairs * (.61 + .53*roofFine + .24*roofMottle + .15*roofNoise(roofP*.61));
        #elif defined(ROOF_STRIPE)
          float paintLoss = smoothstep(.42,.77,roofNoise(roofP*13.0)*.48 + roofFine*.52);
          diffuseColor.rgb *= mix(.48,1.1,paintLoss) * (.8 + .32 * roofMottle);
        #elif defined(ROOF_CONCRETE)
          vec2 wallP = vec2(vRoofWorld.x + vRoofWorld.z*.79, vRoofWorld.y);
          float wallGrain = roofGrain(wallP*24.0);
          float runoff = roofNoise(wallP*vec2(8.5,.46)) * roofNoise(wallP*vec2(2.6,.37));
          diffuseColor.rgb *= .68 + .28*wallGrain + .32*roofNoise(wallP*.55) - runoff*.37;
        #else
          float zinc = roofGrain((roofP+vRoofWorld.yy*.73)*39.0);
          diffuseColor.rgb *= .65 + .55*zinc + .25*roofMottle;
        #endif
      `)
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <roughnessmap_fragment>', /* glsl */ `
        #if defined(ROOF_DECK) || defined(ROOF_ZINC)
          roughnessFactor = clamp(roughnessFactor + .14*(roofFine-.5) + .06*(roofMottle-.5), .04, 1.0);
        #endif
      `)
      if (type === 'deck') shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <normal_fragment_maps>', /* glsl */ `
        float grit = roofFine*.52 + roofGrain(roofP*24.0)*.15;
        vec3 roofDx = dFdx(vViewPosition), roofDy = dFdy(vViewPosition);
        vec3 roofR1 = cross(roofDy, normal), roofR2 = cross(normal, roofDx);
        float roofDet = dot(roofDx, roofR1);
        vec3 roofGrad = (dFdx(grit)*roofR1 + dFdy(grit)*roofR2) * sign(roofDet);
        normal = normalize(max(abs(roofDet), 1e-9)*normal - .00065*roofGrad);
      `)
    },
  })
}

export function finishRoof(deck: DeckSurface, roof: THREE.Group): { material: THREE.MeshStandardMaterial; wetness: 'porous' | 'sheet' }[] {
  const floor = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(.12, .129, .141), roughness: .73, metalness: 0 })
  const concrete = new THREE.MeshStandardMaterial({ color: new THREE.Color(.116, .133, .15), roughness: .83 })
  const zinc = new THREE.MeshStandardMaterial({ color: new THREE.Color(.30, .33, .37), roughness: .49, metalness: .88 })
  const stripe = new THREE.MeshStandardMaterial({ color: new THREE.Color(.47, .46, .39), roughness: .69 })
  stripe.userData.wetPorosity = .23
  const tar = new THREE.MeshStandardMaterial({ color: new THREE.Color(.021, .026, .032), roughness: .88 })
  for (const [mat, type] of [[floor, 'deck'], [concrete, 'concrete'], [zinc, 'zinc'], [stripe, 'stripe']] as const) textureMaterial(mat, type)
  for (const mesh of deck.meshes) mesh.material = floor
  deck.material = floor
  deck.heightMap = relief(deck.bounds)
  roof.traverse(o => {
    if (!(o instanceof THREE.Mesh) || o.material === floor) return
    const n = o.name
    if (/stripes|arrow paint|blank wayfinding/.test(n)) o.material = stripe
    else if (/slot bed|joint seal|underside|doorway back/.test(n)) o.material = tar
    else if (/rail|steel|posts|rim|flange|grate bars|frame|conduit|plate|enclosure|housing|lamp head|camera bracket|louvres|riser|arm$|security camera body/.test(n)) o.material = zinc
    else o.material = concrete
    if (/stripes|arrow paint|joint nosing/.test(n)) o.castShadow = false
  })
  return [{ material: floor, wetness: 'porous' }, { material: concrete, wetness: 'porous' }, { material: zinc, wetness: 'sheet' }, { material: stripe, wetness: 'porous' }]
}
