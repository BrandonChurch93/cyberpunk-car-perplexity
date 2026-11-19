import * as THREE from 'three'
import type { PaintSpec } from '../config'
import { insertAfter, patchMaterial } from '../materials/patch'
import type { VehicleDetail, WetnessKind } from './contract'

export interface VehicleMaterials {
  paint: THREE.MeshPhysicalMaterial
  carbon: THREE.MeshPhysicalMaterial
  glossBlack: THREE.MeshPhysicalMaterial
  matteBlack: THREE.MeshPhysicalMaterial
  liner: THREE.MeshPhysicalMaterial
  glass: THREE.MeshPhysicalMaterial
  lampLens: THREE.MeshPhysicalMaterial
  tailLens: THREE.MeshPhysicalMaterial
  mirrorGlass: THREE.MeshPhysicalMaterial
  rimAlloy: THREE.MeshPhysicalMaterial
  rimMachined: THREE.MeshPhysicalMaterial
  caliper: THREE.MeshPhysicalMaterial
  brakeDisc: THREE.MeshPhysicalMaterial
  brakeHat: THREE.MeshPhysicalMaterial
  tireTread: THREE.MeshPhysicalMaterial
  tireSidewall: THREE.MeshPhysicalMaterial
  engineMetal: THREE.MeshPhysicalMaterial
  engineCover: THREE.MeshPhysicalMaterial
  exhaustBezel: THREE.MeshPhysicalMaterial
  exhaustPipe: THREE.MeshPhysicalMaterial
  interior: THREE.MeshPhysicalMaterial
  drl: THREE.MeshPhysicalMaterial
  projector: THREE.MeshPhysicalMaterial
  tailLight: THREE.MeshPhysicalMaterial
  thirdBrake: THREE.MeshPhysicalMaterial
  surfaces: Array<{ material: THREE.Material; wetness: WetnessKind }>
  setPaint(spec: PaintSpec): void
}

function makeFallbackCarbonTextures(): { color: THREE.DataTexture; normal: THREE.DataTexture; rough: THREE.DataTexture } {
  const size = 64
  const colorData = new Uint8Array(size * size * 4)
  const normalData = new Uint8Array(size * size * 4)
  const roughData = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cellX = Math.floor(x / 8)
      const cellY = Math.floor(y / 8)
      const warp = ((cellX + cellY) % 4) < 2
      const fx = (x % 8) / 8 - 0.5
      const fy = (y % 8) / 8 - 0.5
      const tow = warp ? Math.cos(fx * Math.PI) : Math.cos(fy * Math.PI)
      const lum = Math.round((0.055 + 0.045 * tow) * 255)
      const nx = warp ? Math.round((0.5 - 0.18 * Math.sin(fx * Math.PI)) * 255) : 128
      const ny = !warp ? Math.round((0.5 - 0.18 * Math.sin(fy * Math.PI)) * 255) : 128
      const rg = Math.round((0.36 - 0.12 * tow) * 255)
      const k = (y * size + x) * 4
      colorData[k] = lum; colorData[k + 1] = lum + 2; colorData[k + 2] = lum + 4; colorData[k + 3] = 255
      normalData[k] = nx; normalData[k + 1] = ny; normalData[k + 2] = 248; normalData[k + 3] = 255
      roughData[k] = rg; roughData[k + 1] = rg; roughData[k + 2] = rg; roughData[k + 3] = 255
    }
  }
  const wrap = (tex: THREE.DataTexture, colorSpace: THREE.ColorSpace): THREE.DataTexture => {
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(16, 16)
    tex.colorSpace = colorSpace
    tex.needsUpdate = true
    return tex
  }
  return {
    color: wrap(new THREE.DataTexture(colorData, size, size, THREE.RGBAFormat), THREE.SRGBColorSpace),
    normal: wrap(new THREE.DataTexture(normalData, size, size, THREE.RGBAFormat), THREE.NoColorSpace),
    rough: wrap(new THREE.DataTexture(roughData, size, size, THREE.RGBAFormat), THREE.NoColorSpace),
  }
}

async function loadCarbonTextures(): Promise<{ color: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture }> {
  const fallback = makeFallbackCarbonTextures()
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback
  const loader = new THREE.TextureLoader()
  const base = '/assets/third-party/textures/carbon-weave'
  try {
    const [color, normal, rough] = await Promise.all([
      loader.loadAsync(`${base}/Fabric004_2K-PNG_Color.png`),
      loader.loadAsync(`${base}/Fabric004_2K-PNG_NormalGL.png`),
      loader.loadAsync(`${base}/Fabric004_2K-PNG_Roughness.png`),
    ])
    for (const [tex, cs] of [
      [color, THREE.SRGBColorSpace],
      [normal, THREE.NoColorSpace],
      [rough, THREE.NoColorSpace],
    ] as Array<[THREE.Texture, THREE.ColorSpace]>) {
      tex.wrapS = THREE.RepeatWrapping
      tex.wrapT = THREE.RepeatWrapping
      tex.repeat.set(14, 14)
      tex.anisotropy = 8
      tex.colorSpace = cs
    }
    return { color, normal, rough }
  } catch {
    return fallback
  }
}

function patchMetallicPaint(
  material: THREE.MeshPhysicalMaterial,
  flakeUniform: { value: THREE.Color },
  flakeStrengthUniform: { value: number },
): void {
  patchMaterial(material, {
    id: 'vehicle-paint-flake',
    uniforms: {
      uPaintFlakeColor: flakeUniform,
      uPaintFlakeStrength: flakeStrengthUniform,
    },
    apply(shader) {
      shader.vertexShader = insertAfter(
        shader.vertexShader,
        '#include <common>',
        'varying vec3 vPaintObjPos;',
      )
      shader.vertexShader = insertAfter(
        shader.vertexShader,
        '#include <begin_vertex>',
        'vPaintObjPos = position;',
      )
      shader.fragmentShader = insertAfter(
        shader.fragmentShader,
        '#include <common>',
        /* glsl */ `
        uniform vec3 uPaintFlakeColor;
        uniform float uPaintFlakeStrength;
        varying vec3 vPaintObjPos;

        vec3 paintHash3(vec3 p) {
          p = vec3(
            dot(p, vec3(127.1, 311.7, 74.7)),
            dot(p, vec3(269.5, 183.3, 246.1)),
            dot(p, vec3(113.5, 271.9, 124.6))
          );
          return fract(sin(p) * 43758.5453123);
        }
        `,
      )
      shader.fragmentShader = insertAfter(
        shader.fragmentShader,
        '#include <color_fragment>',
        /* glsl */ `
        if (uPaintFlakeStrength > 0.001) {
          vec3 fCell = floor(vPaintObjPos * 1150.0);
          vec3 rnd = paintHash3(fCell);
          float sparkle = smoothstep(0.62, 0.99, rnd.x);
          diffuseColor.rgb = mix(diffuseColor.rgb, uPaintFlakeColor, sparkle * 0.42 * uPaintFlakeStrength);
        }
        `,
      )
      shader.fragmentShader = insertAfter(
        shader.fragmentShader,
        '#include <normal_fragment_maps>',
        /* glsl */ `
        if (uPaintFlakeStrength > 0.001) {
          vec3 fCellN = floor(vPaintObjPos * 1150.0);
          vec3 rndN = paintHash3(fCellN) * 2.0 - 1.0;
          normal = normalize(normal + rndN * 0.055 * uPaintFlakeStrength);
        }
        `,
      )
      shader.fragmentShader = insertAfter(
        shader.fragmentShader,
        '#include <clearcoat_normal_fragment_maps>',
        /* glsl */ `
        {
          vec3 peelP = vPaintObjPos * 95.0;
          vec3 peel = vec3(
            sin(peelP.x * 1.7 + cos(peelP.z * 1.3)),
            cos(peelP.z * 1.6 + sin(peelP.y * 1.5)),
            sin(peelP.y * 1.4 + cos(peelP.x * 1.8))
          );
          clearcoatNormal = normalize(clearcoatNormal + peel * 0.0042);
        }
        `,
      )
    },
  })
}

function patchCarbonCeramicRotor(material: THREE.MeshPhysicalMaterial): void {
  patchMaterial(material, {
    id: 'vehicle-ccb-rotor',
    apply(shader) {
      shader.vertexShader = insertAfter(
        shader.vertexShader,
        '#include <common>',
        'varying vec3 vRotorLocal;',
      )
      shader.vertexShader = insertAfter(
        shader.vertexShader,
        '#include <begin_vertex>',
        'vRotorLocal = position;',
      )
      shader.fragmentShader = insertAfter(
        shader.fragmentShader,
        '#include <common>',
        /* glsl */ `
        varying vec3 vRotorLocal;
        float rotorHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        `,
      )
      shader.fragmentShader = insertAfter(
        shader.fragmentShader,
        '#include <color_fragment>',
        /* glsl */ `
        {
          float rad = length(vRotorLocal.yz);
          float ang = atan(vRotorLocal.z, vRotorLocal.y);
          float mottle = rotorHash(floor(vRotorLocal.yz * 280.0)) * 0.5 + rotorHash(floor(vRotorLocal.yz * 95.0)) * 0.5;
          float groove = 0.5 + 0.5 * sin(rad * 920.0 + ang * 2.0);
          diffuseColor.rgb *= mix(0.72, 1.24, mottle * 0.65 + groove * 0.35);
        }
        `,
      )
      shader.fragmentShader = insertAfter(
        shader.fragmentShader,
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        {
          float mottleR = rotorHash(floor(vRotorLocal.yz * 220.0));
          roughnessFactor = clamp(roughnessFactor + (mottleR - 0.5) * 0.24, 0.22, 0.72);
        }
        `,
      )
    },
  })
}

function patchHeatTintedMetal(material: THREE.MeshPhysicalMaterial): void {
  patchMaterial(material, {
    id: 'vehicle-exhaust-tint',
    apply(shader) {
      shader.vertexShader = insertAfter(
        shader.vertexShader,
        '#include <common>',
        'varying vec3 vExLocal;',
      )
      shader.vertexShader = insertAfter(
        shader.vertexShader,
        '#include <begin_vertex>',
        'vExLocal = position;',
      )
      shader.fragmentShader = insertAfter(
        shader.fragmentShader,
        '#include <common>',
        'varying vec3 vExLocal;',
      )
      shader.fragmentShader = insertAfter(
        shader.fragmentShader,
        '#include <color_fragment>',
        /* glsl */ `
        {
          float heatBand = clamp((-vExLocal.z - 2.34) * 9.0, 0.0, 1.0);
          vec3 straw = vec3(0.46, 0.36, 0.24);
          vec3 violet = vec3(0.32, 0.27, 0.42);
          vec3 tint = mix(straw, violet, smoothstep(0.35, 0.85, heatBand));
          diffuseColor.rgb = mix(diffuseColor.rgb, tint, 0.45 * smoothstep(0.05, 0.65, heatBand));
        }
        `,
      )
    },
  })
}

export async function createVehicleMaterials(detail: VehicleDetail, initialPaint: PaintSpec): Promise<VehicleMaterials> {
  const drlColor = new THREE.Color(0.92, 0.96, 1.0)
  const beamColor = new THREE.Color(0.94, 0.97, 1.0)
  const tailColor = new THREE.Color(1.0, 0.075, 0.022)

  if (detail === 'blockout') {
    const paint = new THREE.MeshPhysicalMaterial({ color: 0x8d929a, roughness: 0.52, metalness: 0.0, clearcoat: 0.14, clearcoatRoughness: 0.35 })
    const carbon = new THREE.MeshPhysicalMaterial({ color: 0x383b42, roughness: 0.55, metalness: 0.0, clearcoat: 0.1 })
    const glossBlack = new THREE.MeshPhysicalMaterial({ color: 0x2c2f35, roughness: 0.45, metalness: 0.0, clearcoat: 0.15 })
    const matteBlack = new THREE.MeshPhysicalMaterial({ color: 0x222429, roughness: 0.82, metalness: 0.0 })
    const liner = new THREE.MeshPhysicalMaterial({ color: 0x191b1f, roughness: 0.9, metalness: 0.0 })
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x3b4048, roughness: 0.25, metalness: 0.0, clearcoat: 0.35, clearcoatRoughness: 0.15 })
    const lampLens = new THREE.MeshPhysicalMaterial({ color: 0x323740, roughness: 0.2, metalness: 0.0, transparent: true, opacity: 0.38, clearcoat: 0.4 })
    const tailLens = new THREE.MeshPhysicalMaterial({ color: 0x3a2426, roughness: 0.24, metalness: 0.0, transparent: true, opacity: 0.42, clearcoat: 0.35 })
    const mirrorGlass = new THREE.MeshPhysicalMaterial({ color: 0x9aa0aa, roughness: 0.08, metalness: 0.85 })
    const rimAlloy = new THREE.MeshPhysicalMaterial({ color: 0x5c6068, roughness: 0.46, metalness: 0.35 })
    const rimMachined = new THREE.MeshPhysicalMaterial({ color: 0x7c818a, roughness: 0.38, metalness: 0.45 })
    const caliper = new THREE.MeshPhysicalMaterial({ color: 0x4b4f57, roughness: 0.48, metalness: 0.25 })
    const brakeDisc = new THREE.MeshPhysicalMaterial({ color: 0x62666e, roughness: 0.56, metalness: 0.22 })
    const brakeHat = new THREE.MeshPhysicalMaterial({ color: 0x34373e, roughness: 0.52, metalness: 0.35 })
    const tireTread = new THREE.MeshPhysicalMaterial({ color: 0x24262b, roughness: 0.88, metalness: 0.0 })
    const tireSidewall = new THREE.MeshPhysicalMaterial({ color: 0x26292e, roughness: 0.78, metalness: 0.0 })
    const engineMetal = new THREE.MeshPhysicalMaterial({ color: 0x676c75, roughness: 0.44, metalness: 0.4 })
    const engineCover = new THREE.MeshPhysicalMaterial({ color: 0x31343b, roughness: 0.62, metalness: 0.15 })
    const exhaustBezel = new THREE.MeshPhysicalMaterial({ color: 0x4c5058, roughness: 0.48, metalness: 0.42 })
    const exhaustPipe = new THREE.MeshPhysicalMaterial({ color: 0x35383f, roughness: 0.52, metalness: 0.45, side: THREE.DoubleSide })
    const interior = new THREE.MeshPhysicalMaterial({ color: 0x1e2025, roughness: 0.86, metalness: 0.0 })

    const drl = new THREE.MeshPhysicalMaterial({ color: 0x22252b, emissive: drlColor, emissiveIntensity: 0, roughness: 0.22 })
    const projector = new THREE.MeshPhysicalMaterial({ color: 0x282c34, emissive: beamColor, emissiveIntensity: 0, roughness: 0.14 })
    const tailLight = new THREE.MeshPhysicalMaterial({ color: 0x281516, emissive: tailColor, emissiveIntensity: 0, roughness: 0.24 })
    const thirdBrake = new THREE.MeshPhysicalMaterial({ color: 0x241415, emissive: tailColor, emissiveIntensity: 0, roughness: 0.25 })

    const surfaces: Array<{ material: THREE.Material; wetness: WetnessKind }> = [
      { material: paint, wetness: 'beads' },
      { material: carbon, wetness: 'beads' },
      { material: glossBlack, wetness: 'beads' },
      { material: matteBlack, wetness: 'porous' },
      { material: glass, wetness: 'sheet' },
      { material: lampLens, wetness: 'sheet' },
      { material: tailLens, wetness: 'sheet' },
      { material: rimAlloy, wetness: 'beads' },
      { material: rimMachined, wetness: 'beads' },
      { material: tireTread, wetness: 'porous' },
      { material: tireSidewall, wetness: 'porous' },
      { material: engineCover, wetness: 'porous' },
      { material: exhaustBezel, wetness: 'none' },
      { material: brakeDisc, wetness: 'none' },
    ]

    return {
      paint, carbon, glossBlack, matteBlack, liner, glass, lampLens, tailLens, mirrorGlass,
      rimAlloy, rimMachined, caliper, brakeDisc, brakeHat, tireTread, tireSidewall,
      engineMetal, engineCover, exhaustBezel, exhaustPipe, interior,
      drl, projector, tailLight, thirdBrake, surfaces,
      setPaint: () => undefined,
    }
  }

  const weave = await loadCarbonTextures()
  const flakeUniform = { value: new THREE.Color(initialPaint.flake) }
  const flakeStrengthUniform = { value: 1.0 }

  const paint = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(initialPaint.base),
    roughness: 0.24,
    metalness: 0.68,
    clearcoat: 1.0,
    clearcoatRoughness: 0.035,
    ior: 1.52,
    reflectivity: 0.9,
  })
  patchMetallicPaint(paint, flakeUniform, flakeStrengthUniform)

  const setPaint = (spec: PaintSpec): void => {
    paint.color.set(spec.base)
    flakeUniform.value.set(spec.flake)
    const delta =
      Math.abs(flakeUniform.value.r - paint.color.r) +
      Math.abs(flakeUniform.value.g - paint.color.g) +
      Math.abs(flakeUniform.value.b - paint.color.b)
    flakeStrengthUniform.value = delta < 0.04 ? 0.35 : 1.0
    paint.roughness = spec.id === 'liquid-silver' ? 0.18 : 0.24
    paint.metalness = spec.id === 'liquid-silver' ? 0.85 : 0.68
  }
  setPaint(initialPaint)

  const carbon = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.55, 0.57, 0.6),
    map: weave.color,
    normalMap: weave.normal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: weave.rough,
    roughness: 0.38,
    metalness: 0.14,
    clearcoat: 1.0,
    clearcoatRoughness: 0.045,
    ior: 1.52,
  })

  const glossBlack = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.012, 0.013, 0.016),
    roughness: 0.14,
    metalness: 0.08,
    clearcoat: 1.0,
    clearcoatRoughness: 0.035,
    ior: 1.5,
  })

  const matteBlack = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.024, 0.026, 0.03),
    roughness: 0.78,
    metalness: 0.04,
  })

  const liner = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.014, 0.015, 0.018),
    roughness: 0.92,
    metalness: 0.0,
  })

  const glass = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.045, 0.058, 0.068),
    roughness: 0.035,
    metalness: 0.0,
    transmission: 0.58,
    transparent: true,
    opacity: 0.88,
    ior: 1.52,
    thickness: 0.008,
    attenuationColor: new THREE.Color(0.16, 0.22, 0.26),
    attenuationDistance: 0.06,
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
  })

  const lampLens = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.08, 0.095, 0.115),
    roughness: 0.04,
    metalness: 0.0,
    transmission: 0.76,
    transparent: true,
    opacity: 0.42,
    ior: 1.58,
    thickness: 0.004,
    clearcoat: 1.0,
    clearcoatRoughness: 0.025,
  })

  const tailLens = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.18, 0.02, 0.02),
    roughness: 0.06,
    metalness: 0.0,
    transmission: 0.65,
    transparent: true,
    opacity: 0.48,
    ior: 1.56,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
  })

  const mirrorGlass = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.88, 0.91, 0.95),
    roughness: 0.015,
    metalness: 0.98,
  })

  const rimAlloy = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.065, 0.07, 0.08),
    roughness: 0.28,
    metalness: 0.88,
    clearcoat: 0.65,
    clearcoatRoughness: 0.12,
  })

  const rimMachined = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.56, 0.59, 0.64),
    roughness: 0.18,
    metalness: 0.94,
    anisotropy: 0.55,
    clearcoat: 0.8,
    clearcoatRoughness: 0.06,
  })

  const caliper = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.035, 0.038, 0.044),
    roughness: 0.26,
    metalness: 0.55,
    clearcoat: 0.85,
    clearcoatRoughness: 0.08,
  })

  const brakeDisc = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.19, 0.185, 0.18),
    roughness: 0.44,
    metalness: 0.36,
    clearcoat: 0.18,
    clearcoatRoughness: 0.35,
  })
  patchCarbonCeramicRotor(brakeDisc)

  const brakeHat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.045, 0.048, 0.055),
    roughness: 0.38,
    metalness: 0.78,
  })

  const tireTread = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.019, 0.02, 0.023),
    roughness: 0.86,
    metalness: 0.0,
  })

  const tireSidewall = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.022, 0.024, 0.028),
    roughness: 0.64,
    metalness: 0.0,
    clearcoat: 0.12,
    clearcoatRoughness: 0.48,
  })

  const engineMetal = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.34, 0.36, 0.4),
    roughness: 0.32,
    metalness: 0.86,
  })

  const engineCover = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.038, 0.04, 0.046),
    roughness: 0.58,
    metalness: 0.22,
  })

  const exhaustBezel = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.16, 0.155, 0.15),
    roughness: 0.34,
    metalness: 0.82,
  })
  patchHeatTintedMetal(exhaustBezel)

  const exhaustPipe = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.12, 0.115, 0.11),
    roughness: 0.38,
    metalness: 0.85,
    side: THREE.DoubleSide,
  })
  patchHeatTintedMetal(exhaustPipe)

  const interior = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.018, 0.019, 0.023),
    roughness: 0.84,
    metalness: 0.02,
  })

  const drl = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.12, 0.14, 0.16),
    emissive: drlColor,
    emissiveIntensity: 0,
    roughness: 0.14,
    clearcoat: 0.8,
  })

  const projector = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.16, 0.18, 0.22),
    emissive: beamColor,
    emissiveIntensity: 0,
    roughness: 0.08,
    ior: 1.6,
  })

  const tailLight = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.14, 0.02, 0.02),
    emissive: tailColor,
    emissiveIntensity: 0,
    roughness: 0.16,
    clearcoat: 0.8,
  })

  const thirdBrake = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.12, 0.015, 0.015),
    emissive: tailColor,
    emissiveIntensity: 0,
    roughness: 0.2,
  })

  const surfaces: Array<{ material: THREE.Material; wetness: WetnessKind }> = [
    { material: paint, wetness: 'beads' },
    { material: carbon, wetness: 'beads' },
    { material: glossBlack, wetness: 'beads' },
    { material: matteBlack, wetness: 'porous' },
    { material: glass, wetness: 'sheet' },
    { material: lampLens, wetness: 'sheet' },
    { material: tailLens, wetness: 'sheet' },
    { material: rimAlloy, wetness: 'beads' },
    { material: rimMachined, wetness: 'beads' },
    { material: caliper, wetness: 'beads' },
    { material: tireTread, wetness: 'porous' },
    { material: tireSidewall, wetness: 'porous' },
    { material: engineCover, wetness: 'porous' },
    { material: engineMetal, wetness: 'sheet' },
    { material: exhaustBezel, wetness: 'none' },
    { material: exhaustPipe, wetness: 'none' },
    { material: brakeDisc, wetness: 'none' },
  ]

  return {
    paint, carbon, glossBlack, matteBlack, liner, glass, lampLens, tailLens, mirrorGlass,
    rimAlloy, rimMachined, caliper, brakeDisc, brakeHat, tireTread, tireSidewall,
    engineMetal, engineCover, exhaustBezel, exhaustPipe, interior,
    drl, projector, tailLight, thirdBrake, surfaces,
    setPaint,
  }
}
