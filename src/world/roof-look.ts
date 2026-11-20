import * as THREE from 'three'
import { streamSeed } from '../core/random'
import { insertAfter, patchMaterial } from '../materials/patch'
import type { DeckSurface } from './contract'
import { deckJoint, heroDrain } from './deck'

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
    if (r < 1) {
      const shelf = 0.19 * Math.sin(8 * u + 9 * v) + 0.12 * Math.sin(17 * u - 13 * v)
      y -= drop * (1 - r) * (1 + shelf)
    }
  }
  const dx = x - heroDrain[0], dz = z - heroDrain[1]
  const gutterU = dx * 0.94 + dz * 0.34
  const gutterV = dz * 0.94 - dx * 0.34
  y -= 0.0041 * Math.exp(-((gutterU / .81) ** 2 + (gutterV / .18) ** 2))
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

type Type = 'deck' | 'concrete' | 'parapet' | 'zinc' | 'stripe'

const fields = /* glsl */ `
  varying vec3 vRoofWorld;
  uniform float roofSeed;
  uniform vec2 roofDrain;
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
    uniforms: {
      roofSeed: { value: streamSeed(`world/roof/${type}`) / 4294967296 * 37 },
      roofDrain: { value: new THREE.Vector2(...heroDrain) },
    },
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
          vec2 cut = vec2((roofP.x+2.45)/2.35,(roofP.y-5.13+roofP.x*.13)/.87);
          float patchSide = max(abs(cut.x+roofMottle*.039),abs(cut.y+roofMottle*.075)) + roofFine*.038;
          float patchInside = 1.0-smoothstep(.97,1.015,patchSide);
          float patchSeal = (1.0-smoothstep(.014,.039,abs(patchSide-1.013)))*(.45+.55*roofMottle);
          float scuffLine = roofP.x + .52 - .16*roofP.y*roofP.y;
          float tread = 1.0-smoothstep(1.0,3.0,abs(roofP.y-2.5));
          float scuff = tread*(2.0-smoothstep(.11,.33,abs(scuffLine))-smoothstep(.16,.34,abs(scuffLine+1.38)));
          scuff *= .56+.44*roofGrain(roofP*vec2(17.0,4.1));
          float oil = (1.0-smoothstep(.16,.9,length((roofP-vec2(.45,-.53))*vec2(2.1,1.0)) + .24*roofMottle));
          vec2 drain = (roofP-roofDrain)*vec2(4.3,3.0);
          float silt = (1.0-smoothstep(.27,1.31,length(drain)+roofFine*.54))*(.42+.58*roofMottle);
          float repairs = .86+.22*patchInside-.23*patchSeal-.25*scuff-.34*oil+.29*silt;
          diffuseColor.rgb *= repairs*(.67+.33*roofFine+.31*roofMottle+.19*roofNoise(roofP*.61));
        #elif defined(ROOF_STRIPE)
          float paintLoss = smoothstep(.42,.77,roofNoise(roofP*13.0)*.48 + roofFine*.52);
          diffuseColor.rgb *= mix(.48,1.1,paintLoss) * (.8 + .32 * roofMottle);
        #elif defined(ROOF_PARAPET)
          vec2 wallP = vec2(vRoofWorld.x+vRoofWorld.z*.79,vRoofWorld.y);
          float board = wallP.x*.46;
          float seam = (1.0-smoothstep(.004,.018+fwidth(board),abs(fract(board+.5)-.5)));
          float trail = roofNoise(wallP*vec2(10.2,.62))*roofNoise(wallP*vec2(3.9,.84));
          float lip = smoothstep(.49,.60,wallP.y);
          float splash = (1.0-smoothstep(.036,.21,wallP.y))*(.47+.53*roofNoise(wallP*9.0));
          float wallLook = .71+.26*roofGrain(wallP*24.0)+.26*roofNoise(vec2(floor(board),1.0));
          diffuseColor.rgb *= wallLook-.27*seam-.47*trail-.17*splash+.16*lip;
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
        float grit = roofFine*.37 + roofGrain(roofP*24.0)*.22;
        vec3 roofDx = dFdx(vViewPosition), roofDy = dFdy(vViewPosition);
        vec3 roofR1 = cross(roofDy, normal), roofR2 = cross(normal, roofDx);
        float roofDet = dot(roofDx, roofR1);
        vec3 roofGrad = (dFdx(grit)*roofR1 + dFdy(grit)*roofR2) * sign(roofDet);
        normal = normalize(max(abs(roofDet), 1e-9)*normal - .00047*roofGrad);
      `)
    },
  })
}

export function finishRoof(deck: DeckSurface, roof: THREE.Group): { material: THREE.MeshStandardMaterial; wetness: 'porous' | 'sheet' }[] {
  const floor = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(.12, .129, .141), roughness: .73, metalness: 0 })
  const concrete = new THREE.MeshStandardMaterial({ color: new THREE.Color(.116, .133, .15), roughness: .83 })
  const parapet = new THREE.MeshStandardMaterial({ color: new THREE.Color(.111, .128, .145), roughness: .79 })
  const zinc = new THREE.MeshStandardMaterial({ color: new THREE.Color(.30, .33, .37), roughness: .49, metalness: .88 })
  const stripe = new THREE.MeshStandardMaterial({ color: new THREE.Color(.47, .46, .39), roughness: .69 })
  stripe.userData.wetPorosity = .23
  const tar = new THREE.MeshStandardMaterial({ color: new THREE.Color(.021, .026, .032), roughness: .88 })
  for (const [mat, type] of [[floor, 'deck'], [concrete, 'concrete'], [parapet, 'parapet'], [zinc, 'zinc'], [stripe, 'stripe']] as const) textureMaterial(mat, type)
  for (const mesh of deck.meshes) mesh.material = floor
  deck.material = floor
  deck.heightMap = relief(deck.bounds)
  roof.traverse(o => {
    if (!(o instanceof THREE.Mesh) || o.material === floor) return
    const n = o.name
    if (/stripes|arrow paint|blank wayfinding/.test(n)) o.material = stripe
    else if (n === 'solid concrete' || n === 'concrete piers') o.material = parapet
    else if (/slot bed|joint seal|underside|doorway back/.test(n)) o.material = tar
    else if (/rail|steel|posts|rim|flange|grate bars|frame|conduit|plate|enclosure|housing|lamp head|camera bracket|louvres|riser|arm$|security camera body/.test(n)) o.material = zinc
    else o.material = concrete
    if (/stripes|arrow paint|joint nosing/.test(n)) o.castShadow = false
  })
  return [{ material: floor, wetness: 'porous' }, { material: concrete, wetness: 'porous' }, { material: parapet, wetness: 'porous' }, { material: zinc, wetness: 'sheet' }, { material: stripe, wetness: 'porous' }]
}
