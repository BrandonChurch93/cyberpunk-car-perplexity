import * as T from 'three'
import { insertAfter, patchMaterial } from '../../materials/patch'
import type { SurfaceCurve } from '../geom/cuts'

export const forward = new T.Vector3(0, 0, 1)

export function guideOptics(material: T.MeshStandardMaterial, paths: readonly SurfaceCurve[], halfWidth: number): void {
  const segments: T.Vector4[] = []
  const lengths: T.Vector2[] = []
  for (const path of paths) {
    let prev = 0, length = 0
    for (let end = 1; end < path.p.length; end++) {
      if (end % 8 && end !== path.p.length - 1) continue
      const a = path.p[prev], b = path.p[end]
      const span = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (span < 1e-6) continue
      segments.push(new T.Vector4(a[0], a[1], b[0] - a[0], b[1] - a[1]))
      lengths.push(new T.Vector2(span, length))
      length += span
      prev = end
    }
  }
  patchMaterial(material, {
    id: `front-guide-optics-${segments.length}`,
    uniforms: { guideSegments: { value: segments }, guideLengths: { value: lengths }, guideHalfWidth: { value: halfWidth } },
    apply(shader) {
      shader.vertexShader = insertAfter(shader.vertexShader, '#include <common>', 'varying vec2 vGuidePlane;')
      shader.vertexShader = insertAfter(shader.vertexShader, '#include <begin_vertex>', 'vGuidePlane = position.xy;')
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <common>', `
        uniform vec4 guideSegments[${segments.length}];
        uniform vec2 guideLengths[${segments.length}];
        uniform float guideHalfWidth;
        varying vec2 vGuidePlane;
        float guideRadiance() {
          float nearest = 1.0;
          float along = 0.0;
          vec2 plane = vec2(abs(vGuidePlane.x), vGuidePlane.y);
          for (int i = 0; i < ${segments.length}; ++i) {
            vec4 segment = guideSegments[i];
            vec2 local = plane - segment.xy;
            float t = clamp(dot(local, segment.zw) / dot(segment.zw, segment.zw), 0.0, 1.0);
            float dist = length(local - t * segment.zw);
            if (dist < nearest) {
              nearest = dist;
              along = guideLengths[i].y + t * guideLengths[i].x;
            }
          }
          float crossSection = nearest / guideHalfWidth;
          float sleeve = 0.0015 + 0.043 * (1.0 - smoothstep(0.25, 0.99, crossSection));
          float core = crossSection / 0.145;
          float pocket = smoothstep(0.28, 0.44, crossSection) * (1.0 - smoothstep(0.67, 0.91, crossSection));
          float pitch = along / 0.010;
          float facets = 0.08 * pocket * cos(PI2 * pitch) * smoothstep(0.003, 0.014, along)
            * (1.0 - smoothstep(0.12, 0.45, fwidth(pitch)));
          float resolve = 1.0 - smoothstep(0.065, 0.20, length(fwidth(vGuidePlane)) / guideHalfWidth);
          return mix(1.05, sleeve * (1.0 + facets) + 5.65 * exp(-0.5 * core * core), resolve);
        }`)
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <emissivemap_fragment>',
        'totalEmissiveRadiance *= guideRadiance();')
    },
  })
}

export function projectorOptics(material: T.MeshStandardMaterial): void {
  patchMaterial(material, {
    id: 'projector-source',
    apply(shader) {
      shader.vertexShader = insertAfter(shader.vertexShader, '#include <common>', 'attribute float sourceGain; varying float vSourceGain;')
      shader.vertexShader = insertAfter(shader.vertexShader, '#include <begin_vertex>', 'vSourceGain = sourceGain;')
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <common>', 'varying float vSourceGain;')
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <emissivemap_fragment>',
        'diffuseColor.rgb *= mix(0.13, 1.0, step(0.1, vSourceGain)); totalEmissiveRadiance *= vSourceGain;')
    },
  })
}

export function projectorParts(center: T.Vector3, axis: T.Vector3, radius: number, full: boolean) {
  const rotation = new T.Quaternion().setFromUnitVectors(forward, axis)
  const fit = (g: T.BufferGeometry) => g.rotateX(Math.PI / 2).scale(1, .84, 1).applyQuaternion(rotation).translate(...center.toArray())
  const turn = (profile: readonly (readonly [number, number])[]) =>
    new T.LatheGeometry(profile.map(([r, z]) => new T.Vector2(radius * (r || 1e-5), z)), full ? 80 : 32)
  const casework = fit(turn([[0, -.034], [1.12, -.034], [1.17, -.028], [1.16, -.017], [1.085, -.007], [1.063, -.005]]))
  const collar = fit(turn([[1.063, -.005], [1.055, -.0023], [1.025, -.0006], [1.009, -.0005],
    [1.003, -.0009], [.989, -.0009], [.984, -.00035], [.970, -.00035], [.964, -.00075],
    [.951, -.00075], [.944, -.0011], [.931, -.0024], [.927, -.0041], [.908, -.0053], [.878, -.0053], [.875, -.007]]))
  const bowlProfile = [[.875, -.007], [.857, -.0077], [.818, -.0088], [.754, -.0113], [.688, -.0137],
    [.665, -.015], [.633, -.0153], [.608, -.0149], [.555, -.0171], [.485, -.0194], [.414, -.0212],
    [.373, -.023], [.352, -.0244], [.311, -.0245], [.286, -.0237], [0, -.0237]] as const
  const bowl = turn(bowlProfile)
  const wall = bowl.getAttribute('position')
  for (let i = 0; i < wall.count; i++) {
    const x = wall.getX(i), z = wall.getZ(i), r = Math.hypot(x, z) / radius
    const sector = Math.atan2(x, z) / (2 * Math.PI) * 16
    const facet = Math.abs(2 * (sector - Math.floor(sector)) - 1)
    const fade = T.MathUtils.smoothstep(r, .28, .49) * (1 - T.MathUtils.smoothstep(r, .79, .873))
    wall.setY(i, wall.getY(i) - .00165 * fade * facet)
  }
  bowl.computeVertexNormals()
  const normals = bowl.getAttribute('normal')
  for (let j = 0; j < bowlProfile.length; j++) {
    const last = wall.count - bowlProfile.length + j
    const n = new T.Vector3().fromBufferAttribute(normals, j).add(new T.Vector3().fromBufferAttribute(normals, last)).normalize()
    normals.setXYZ(j, ...n.toArray())
    normals.setXYZ(last, ...n.toArray())
  }
  const dome = Array.from({ length: (full ? 20 : 10) + 1 }, (_, i) => {
    const angle = Math.PI / 2 * (1 - i / (full ? 20 : 10))
    return [.910 * Math.sin(angle), -.0043 + radius * .235 * Math.cos(angle)] as const
  })
  const lens = fit(turn([[0, -.0059], [.885, -.0059], [.910, -.0055], ...dome]))
  const source = new T.BufferGeometry()
  const positions: number[] = [], gains: number[] = [], indices: number[] = []
  const die = (x: number, y: number, z: number, w: number, h: number, gain: number) => {
    const base = gains.length
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = new T.Vector3(radius * (x + dx * w / 2), radius * (y + dy * h / 2), z - .0145)
      positions.push(...p.applyQuaternion(rotation).add(center).toArray())
      gains.push(gain)
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  die(0, 0, -.0005, .51, .38, .0008)
  for (const y of [-1, 1]) for (const x of [-1, 1]) {
    die(x * .108, y * .075, 0, .181, .121, x === y ? .60 : 1.12)
    die(x * .222, y * .075, -.00018, .031, .042, .003)
  }
  source.setAttribute('position', new T.Float32BufferAttribute(positions, 3))
  source.setAttribute('sourceGain', new T.Float32BufferAttribute(gains, 1))
  source.setIndex(indices)
  source.computeVertexNormals()
  return { casework, collar, bowl: fit(bowl), lens, source }
}
