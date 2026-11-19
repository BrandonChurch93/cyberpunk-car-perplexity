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
    microtexture.magFilter = T.LinearFilter
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
        float carFlake(vec2 surface, float scale) {
          vec2 cells = surface * scale;
          ivec2 tileSize = textureSize(carMicrostructure, 0);
          vec3 grain = texelFetch(carMicrostructure, ivec2(mod(floor(cells), vec2(tileSize))), 0).rgb;
          vec2 delta = fract(cells) - (0.32 + grain.gb * 0.36);
          float theta = 6.2831853 * grain.g;
          float c = cos(theta), s = sin(theta);
          delta = mat2(c, -s, s, c) * delta;
          float edge = length(delta * vec2(1.0, 1.6 + grain.b * 0.6));
          float footprint = min(0.24, 0.42 * length(fwidth(cells)));
          float radius = 0.13 + 0.15 * grain.b;
          return smoothstep(0.64, 0.98, grain.r) * (1.0 - smoothstep(radius - footprint, radius + footprint, edge));
        }
      ` + shader.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 basis = normalize(abs(cross(dFdx(carLocal), dFdy(carLocal))) + vec3(0.000000001));
          vec3 weights = pow(basis, vec3(8.0));
          weights /= max(0.00001, weights.x + weights.y + weights.z);
          float flakeGrain = dot(weights, vec3(carFlake(carLocal.yz, 1460.0), carFlake(carLocal.xz, 1420.0), carFlake(carLocal.xy, 1530.0)));
          vec3 orangePeel = carGrain(vec3(3.35), weights);
          float footprint = length(fwidth(carLocal)) * 1550.0;
          float nearWeight = 1.0 - smoothstep(0.7, 2.6, footprint);
          float kick = flakeGrain * nearWeight;
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
    color: full ? 0xb6c2c7 : 0x30383f, metalness: full ? 0 : .1, roughness: full ? .084 : .17,
    ior: 1.51, clearcoat: .8, clearcoatRoughness: .07, transmission: full ? .92 : 0,
    thickness: full ? .006 : 0, attenuationColor: new T.Color(0x7a9a9c), attenuationDistance: .009,
    opacity: full ? 1 : .87, transparent: !full, depthWrite: full, side: T.FrontSide,
  })
  const optics = new T.MeshPhysicalMaterial({
    color: full ? 0xedf0f3 : 0x858e99, metalness: full ? 0 : .1, roughness: full ? .071 : .105,
    opacity: full ? 1 : .36, transparent: !full, depthWrite: full, ior: 1.59, clearcoat: .95, clearcoatRoughness: .09,
    transmission: full ? .93 : 0, thickness: full ? .0038 : 0, attenuationColor: new T.Color(0xaabcc7), attenuationDistance: .016,
  })
  const rearOptics = optics.clone()
  rearOptics.color.setHex(full ? 0xe6a4a4 : 0x51373a)
  rearOptics.opacity = full ? 1 : .30
  rearOptics.attenuationColor.setHex(0xad2828)
  rearOptics.attenuationDistance = .013
  const brushed = new T.MeshPhysicalMaterial({
    color: full ? 0x899496 : 0x7f858c, metalness: full ? .79 : .45, roughness: .32, anisotropy: full ? .69 : .2,
  })
  const forged = new T.MeshPhysicalMaterial({
    color: full ? 0x484b51 : 0x777c83, metalness: full ? .69 : .46, roughness: .25,
    clearcoat: .67, clearcoatRoughness: .18, anisotropy: full ? .32 : 0,
  })
  const spoke = new T.MeshPhysicalMaterial({
    color: full ? 0x747982 : 0x777c83, metalness: full ? .62 : .46, roughness: .30,
    clearcoat: .5, clearcoatRoughness: .20, anisotropy: full ? .31 : 0,
  })
  const brake = new T.MeshStandardMaterial({ color: full ? 0x373c3f : 0x4e5154, roughness: .78, metalness: .24 })
  const caliper = new T.MeshPhysicalMaterial({
    color: full ? 0x9a2520 : 0x64676c, metalness: .30, roughness: .34, clearcoat: .65, clearcoatRoughness: .22,
  })
  const matte = new T.MeshPhysicalMaterial({ color: full ? 0x22252a : 0x32363b, roughness: .72, metalness: .09 })
  const dark = new T.MeshStandardMaterial({ color: full ? 0x131518 : 0x26292d, roughness: .83 })
  const tire = new T.MeshPhysicalMaterial({ color: full ? 0x252629 : 0x2d3032, roughness: .81, specularIntensity: .68 })
  const carbon = new T.MeshPhysicalMaterial({
    color: full ? 0xb5bec4 : 0x41454b, metalness: .33, roughness: .36, clearcoat: .82, clearcoatRoughness: .137, anisotropy: full ? .32 : 0,
  })
  const mirror = new T.MeshPhysicalMaterial({ color: 0x89969e, metalness: .94, roughness: .145, clearcoat: .78 })
  const hot = new T.MeshPhysicalMaterial({ color: full ? 0x494241 : 0x626367, metalness: .72, roughness: .4, anisotropy: full ? .38 : 0 })
  const engine = new T.MeshStandardMaterial({ color: full ? 0x2b2d31 : 0x55595f, metalness: .38, roughness: .59 })
  const cabin = new T.MeshStandardMaterial({ color: 0x2e2b2a, metalness: 0, roughness: .84 })
  if (full) {
    const seeded = (name: string) => ({ value: stream(name).range(.1, 21) })
    const grain = (m: Material, name: string, color: string, roughness = '') => patchMaterial(m, {
      id: name,
      uniforms: { carFinishSeed: seeded(name) },
      apply(shader) {
        shader.vertexShader = 'varying vec3 carFinishPoint;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ncarFinishPoint = position;')
        shader.fragmentShader = `varying vec3 carFinishPoint;
          uniform float carFinishSeed;
          float finishCell(vec3 p) {
            p = fract(p * vec3(0.1031, 0.0973, 0.1099));
            p += dot(p, p.yzx + carFinishSeed + 19.19);
            return fract((p.x + p.y) * p.z);
          }
        ` + shader.fragmentShader
          .replace('#include <color_fragment>', '#include <color_fragment>\n' + color)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + roughness)
      },
    })
    grain(brake, 'carbon ceramic porosity', `
      vec3 cell = floor(carFinishPoint * vec3(160.0, 710.0, 710.0));
      float grain = finishCell(cell);
      float r = length(carFinishPoint.yz);
      float band = sin(r * 1716.0 + 0.5 * sin(r * 527.0));
      float carGrainWeight = 1.0 - smoothstep(0.00045, 0.0028, length(fwidth(carFinishPoint.yz)));
      diffuseColor.rgb *= 1.0 + (grain - 0.5) * 0.28 * carGrainWeight + 0.045 * band * carGrainWeight;
    `, 'roughnessFactor += (grain - 0.5) * 0.19 * carGrainWeight;')
    grain(tire, 'mold rubber grain', `
      vec3 cell = floor(carFinishPoint * 1450.0);
      float grain = finishCell(cell);
      float carGrainWeight = 1.0 - smoothstep(0.00035, 0.0022, length(fwidth(carFinishPoint)));
      diffuseColor.rgb *= 1.0 + (grain - 0.5) * 0.13 * carGrainWeight;
    `, 'roughnessFactor += (grain - 0.5) * 0.10 * carGrainWeight;')
    grain(hot, 'heat tint and drawn alloy', `
      float shape = carFinishPoint.z + 2.40 + 0.006 * sin(carFinishPoint.x * 22.0);
      float oxide = smoothstep(0.011, 0.035, shape) - smoothstep(0.051, 0.08, shape);
      float temper = smoothstep(-0.025, 0.015, shape) - smoothstep(0.015, 0.048, shape);
      float rough = finishCell(floor(carFinishPoint * vec3(480.0, 660.0, 580.0)));
      diffuseColor.rgb *= 1.0 + (rough - 0.5) * 0.07;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.17, 0.082, 0.027), oxide * 0.42);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.060, 0.071, 0.14), temper * 0.36);
    `, 'roughnessFactor += 0.12 * oxide;')
  }
  const surfaces: VehicleModule['surfaces'] = []
  const tag = (material: Material, wetness: VehicleModule['surfaces'][number]['wetness']) => {
    surfaces.push({ material, wetness })
    return material
  }
  for (const m of [paint, glass, optics, rearOptics, carbon, mirror]) tag(m, 'beads')
  for (const m of [matte, tire]) tag(m, 'sheet')
  for (const m of [brushed, forged, spoke, brake, caliper, dark, hot, engine]) tag(m, 'none')
  if (full) tag(cabin, 'none')
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
      tex.repeat.set(31, 31)
      tex.anisotropy = 4
      tex.colorSpace = key === 'map' ? T.SRGBColorSpace : T.NoColorSpace
      carbon[key as keyof typeof carbonPaths] = tex
    }))
    carbon.normalScale.setScalar(.2)
    carbon.needsUpdate = true
  }
  return { paint, glass, optics, rearOptics, brushed, forged, spoke, brake, caliper, matte, dark, tire, carbon, mirror, hot, engine, cabin, surfaces, tag, setPaint, load }
}

export type Palette = ReturnType<typeof palette>
