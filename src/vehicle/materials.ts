import * as T from 'three'
import type { PaintSpec } from '../config'
import { stream } from '../core/random'
import { patchMaterial } from '../materials/patch'
import type { VehicleModule } from './contract'
import type { Material } from './geometry'

const carbonPaths = {
  map: '/assets/third-party/textures/carbon-weave/Fabric004_2K-PNG_Color.png',
  normalMap: '/assets/third-party/textures/carbon-weave/Fabric004_2K-PNG_NormalGL.png',
  roughnessMap: '/assets/third-party/textures/carbon-weave/Fabric004_2K-PNG_Roughness.png',
}

export function palette(spec: PaintSpec, full: boolean) {
  const flake = { value: new T.Color(spec.flake) }
  const tint = { value: new T.Color(spec.base) }
  const paint = new T.MeshPhysicalMaterial({
    color: full ? spec.base : 0x93989f, metalness: full ? .39 : .13,
    roughness: full ? .265 : .36, clearcoat: full ? 1 : .48, clearcoatRoughness: full ? .11 : .22,
    ior: 1.53, specularIntensity: .7, envMapIntensity: 1.15,
  })
  if (full) {
    const random = stream('vehicle paint flakes')
    const data = new Uint8Array(64 * 64 * 4)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = random.int(256)
      data[i + 1] = random.int(256)
      data[i + 2] = random.int(256)
      data[i + 3] = 255
    }
    const microtexture = new T.DataTexture(data, 64, 64, T.RGBAFormat)
    microtexture.wrapS = microtexture.wrapT = T.RepeatWrapping
    microtexture.magFilter = T.NearestFilter
    microtexture.minFilter = T.LinearMipmapLinearFilter
    microtexture.generateMipmaps = true
    microtexture.needsUpdate = true
    patchMaterial(paint, {
      id: 'vehicle paint stack',
      uniforms: { carFlakeTint: flake, carBaseTint: tint, carMicrostructure: { value: microtexture } },
      apply(shader) {
      shader.vertexShader = 'varying vec3 carLocal;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ncarLocal = position;')
      shader.fragmentShader = `varying vec3 carLocal;
        uniform vec3 carFlakeTint;
        uniform vec3 carBaseTint;
        uniform sampler2D carMicrostructure;
        vec3 carGrain(vec3 frequency, vec3 weights) {
          return weights.x * texture2D(carMicrostructure, carLocal.yz * frequency.x).rgb
            + weights.y * texture2D(carMicrostructure, carLocal.xz * frequency.y).rgb
            + weights.z * texture2D(carMicrostructure, carLocal.xy * frequency.z).rgb;
        }
      ` + shader.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 basis = normalize(abs(cross(dFdx(carLocal), dFdy(carLocal))) + vec3(0.000000001));
          vec3 weights = pow(basis, vec3(8.0));
          weights /= max(0.00001, weights.x + weights.y + weights.z);
          vec3 flakeGrain = carGrain(vec3(23.0, 22.0, 24.0), weights);
          vec3 orangePeel = carGrain(vec3(3.35), weights);
          float footprint = length(fwidth(carLocal)) * 1550.0;
          float nearWeight = 1.0 - smoothstep(0.7, 2.6, footprint);
          float kick = smoothstep(0.78, 0.98, flakeGrain.r) * nearWeight;
          diffuseColor.rgb *= 0.985 + 0.038 * orangePeel.r;
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(carBaseTint, carFlakeTint, 0.36), kick * 0.14);
        `)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor += (orangePeel.b - 0.5) * 0.015 - kick * 0.19;
        `)
        .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
          material.specularColor = mix(material.specularColor, max(material.specularColor, carFlakeTint), kick * 0.36);
          #ifdef USE_CLEARCOAT
            material.clearcoatRoughness += (orangePeel.g - 0.5) * 0.025;
          #endif
        `)
      },
    })
  }
  const glass = new T.MeshPhysicalMaterial({
    color: full ? 0x455359 : 0x30383f, metalness: .1, roughness: full ? .096 : .17,
    ior: 1.49, clearcoat: .8, clearcoatRoughness: .07,
    opacity: full ? .72 : .87, transparent: true, depthWrite: false, side: T.FrontSide,
  })
  const optics = new T.MeshPhysicalMaterial({
    color: full ? 0x88959f : 0x858e99, metalness: .1, roughness: .105,
    opacity: full ? .33 : .36, transparent: true, depthWrite: false, ior: 1.59, clearcoat: .95, clearcoatRoughness: .09,
  })
  const rearOptics = optics.clone()
  rearOptics.color.setHex(full ? 0x681015 : 0x51373a)
  rearOptics.opacity = .30
  const brushed = new T.MeshPhysicalMaterial({
    color: full ? 0x899496 : 0x7f858c, metalness: full ? .79 : .45, roughness: .32, anisotropy: full ? .69 : .2,
  })
  const forged = new T.MeshPhysicalMaterial({
    color: full ? 0x484b51 : 0x777c83, metalness: full ? .69 : .46, roughness: .25,
    clearcoat: .67, clearcoatRoughness: .18, anisotropy: full ? .32 : 0,
  })
  const brake = new T.MeshStandardMaterial({ color: full ? 0x6e7070 : 0x68696c, roughness: .74, metalness: .29 })
  const caliper = new T.MeshPhysicalMaterial({
    color: full ? 0x9a2520 : 0x64676c, metalness: .30, roughness: .34, clearcoat: .65, clearcoatRoughness: .22,
  })
  const matte = new T.MeshStandardMaterial({ color: full ? 0x17191c : 0x32363b, roughness: .72, metalness: .09 })
  const dark = new T.MeshStandardMaterial({ color: full ? 0x131518 : 0x26292d, roughness: .83 })
  const tire = new T.MeshStandardMaterial({ color: full ? 0x252629 : 0x2d3032, roughness: .81 })
  const carbon = new T.MeshPhysicalMaterial({
    color: full ? 0x66696c : 0x41454b, metalness: .33, roughness: .36, clearcoat: .82, clearcoatRoughness: .137, anisotropy: full ? .32 : 0,
  })
  const mirror = new T.MeshPhysicalMaterial({ color: 0x89969e, metalness: .94, roughness: .145, clearcoat: .78 })
  const hot = new T.MeshPhysicalMaterial({ color: full ? 0x494241 : 0x626367, metalness: .72, roughness: .4, anisotropy: full ? .38 : 0 })
  const engine = new T.MeshStandardMaterial({ color: full ? 0x2b2d31 : 0x55595f, metalness: .38, roughness: .59 })
  const surfaces: VehicleModule['surfaces'] = []
  const tag = (material: Material, wetness: VehicleModule['surfaces'][number]['wetness']) => {
    surfaces.push({ material, wetness })
    return material
  }
  for (const m of [paint, glass, optics, rearOptics, carbon, mirror]) tag(m, 'beads')
  for (const m of [matte, tire]) tag(m, 'sheet')
  for (const m of [brushed, forged, brake, caliper, dark, hot, engine]) tag(m, 'none')
  const setPaint = (next: PaintSpec): void => {
    if (full) {
      paint.color.set(next.base)
      tint.value.set(next.base)
      flake.value.set(next.flake)
    }
  }
  const load = async (): Promise<void> => {
    if (!full || typeof document === 'undefined') return
    const loader = new T.TextureLoader()
    await Promise.all(Object.entries(carbonPaths).map(async ([key, path]) => {
      const tex = await loader.loadAsync(import.meta.env.BASE_URL + path.slice(1))
      tex.wrapS = tex.wrapT = T.RepeatWrapping
      tex.repeat.set(2, 3)
      tex.anisotropy = 4
      tex.colorSpace = key === 'map' ? T.SRGBColorSpace : T.NoColorSpace
      carbon[key as keyof typeof carbonPaths] = tex
    }))
    carbon.normalScale.setScalar(.2)
    carbon.needsUpdate = true
  }
  return { paint, glass, optics, rearOptics, brushed, forged, brake, caliper, matte, dark, tire, carbon, mirror, hot, engine, surfaces, tag, setPaint, load }
}

export type Palette = ReturnType<typeof palette>
