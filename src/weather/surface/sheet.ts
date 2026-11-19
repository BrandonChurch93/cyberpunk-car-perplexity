import type * as THREE from 'three'
import { config } from '../../config'
import { insertAfter, insertBefore, patchMaterial } from '../../materials/patch'
import { surfaceCommonGlsl, surfaceVaryingsGlsl, surfaceVertexGlsl } from './glsl'
import type { Uniforms } from './porous'

/** Cells of the flowing film noise along the fall line. The film moves this many cells per film loop, so it repeats exactly. */
const flowCells = 96
const flowCellMeters = 0.022

/**
 * A thin moving film on steel, dark trim and lamp lenses, with rivulets on the fall line. Board 12: rubber is matte dry,
 * albedo 0.04 to 0.06 and roughness 0.75 to 0.9, and only goes glossy (0.2 to 0.3) where film covers an exposed face.
 */
const sheetGlsl = /* glsl */ `
uniform float surfDiag;
uniform float surfTime;
uniform float surfRubber;
#define SURF_FLOW_CELLS ${flowCells}
#define SURF_FLOW_CELL ${flowCellMeters.toFixed(4)}
#define SURF_FILM_SECONDS ${config.film.durationSeconds.toFixed(3)}
`

const sheetFragment = /* glsl */ `
float surfFilmOut = 0.0;
{
  vec3 n = normalize(surfObjNormal);
  vec3 g = normalize(surfObjGravity);
  vec3 gt = g - n * dot(g, n);
  float slope = length(gt);
  vec3 down = slope > 1e-3 ? gt / slope : normalize(cross(n, vec3(0.31, 0.53, 0.79)));
  vec3 side = normalize(cross(n, down));
  vec3 p = surfObjPos;
  float level = -dot(n, g);
  float pix = max(length(fwidth(p)), 1e-6);
  float flow = surfTime / SURF_FILM_SECONDS * float(SURF_FLOW_CELLS);
  vec2 q = vec2(dot(p, side), dot(p, down)) / SURF_FLOW_CELL;
  float expose = smoothstep(-0.4, 0.3, level);
  float film = surfNoise2Periodic(vec2(q.x * 0.7, q.y * 0.35 - flow), SURF_FLOW_CELLS, 41u);
  film = smoothstep(0.32, 0.68, film * 0.7 + 0.3 * surfNoise2(q * 2.3, 42u));
  float lane = q.x * 4.0 + 0.6 * sin(q.y * 1.7 + 3.0 * surfNoise2(vec2(floor(q.x * 4.0), 0.0), 43u));
  float laneId = floor(lane);
  float laneOn = step(0.62, surfHash2(ivec2(int(laneId), 7), 44u).x) * smoothstep(0.25, 0.6, slope);
  float laneD = abs(fract(lane) - 0.5);
  float laneW = 0.11;
  float rivulet = laneOn * (1.0 - smoothstep(laneW - 0.03, laneW + 0.02, laneD));
  float pulse = surfNoise2Periodic(vec2(laneId, q.y * 0.5 - flow * 2.0), SURF_FLOW_CELLS, 45u);
  rivulet *= smoothstep(0.35, 0.6, pulse);
  float wet = clamp(mix(0.35, 0.85, film) * mix(0.55, 1.0, expose) + rivulet, 0.0, 1.0);
  float detail = 1.0 - smoothstep(0.002, 0.02, pix);
  vec3 bend = vec3(0.0);
  float e = 0.35;
  float fx = surfNoise2Periodic(vec2((q.x + e) * 0.7, q.y * 0.35 - flow), SURF_FLOW_CELLS, 41u);
  float fy = surfNoise2Periodic(vec2(q.x * 0.7, (q.y + e) * 0.35 - flow), SURF_FLOW_CELLS, 41u);
  float f0 = surfNoise2Periodic(vec2(q.x * 0.7, q.y * 0.35 - flow), SURF_FLOW_CELLS, 41u);
  bend += 0.12 * detail * ((fx - f0) * side + (fy - f0) * down);
  float laneSlope = laneOn * (fract(lane) - 0.5) / laneW;
  bend += 0.5 * detail * rivulet * laneSlope * side;
  vec3 nObj = normalize(n - bend);
  mat3 toView = mat3(surfObjToView0, surfObjToView1, surfObjToView2);
  vec3 filmView = normalize(toView * nObj);
  if (surfRubber > 0.5) {
    float cover = wet * expose;
    diffuseColor.rgb *= mix(1.0, 0.55, cover);
    roughnessFactor = mix(roughnessFactor, mix(0.32, 0.22, film), cover * (0.4 + 0.6 * film));
    normal = normalize(mix(normal, filmView, cover));
    surfFilmOut = cover;
  } else {
    diffuseColor.rgb *= mix(1.0, 0.8, wet);
    roughnessFactor = mix(roughnessFactor, min(roughnessFactor, mix(0.2, 0.06, film)), wet);
    normal = normalize(mix(normal, filmView, wet));
    surfFilmOut = wet;
  }
  surfDiagOut = vec4(vec3(0.1, 0.9, 1.0) * (0.15 + 0.85 * surfFilmOut), 1.0);
}
`

export function applySheet(material: THREE.Material, uniforms: Uniforms, rubber: boolean): void {
  patchMaterial(material, {
    id: rubber ? 'surface water rubber' : 'surface water sheet',
    uniforms: { ...uniforms, surfRubber: { value: rubber ? 1 : 0 } },
    apply(shader) {
      shader.vertexShader = surfaceVaryingsGlsl(true) + insertAfter(shader.vertexShader, '#include <project_vertex>', surfaceVertexGlsl(true))
      let f = shader.fragmentShader
      f = surfaceVaryingsGlsl(true) + surfaceCommonGlsl + sheetGlsl + f
      f = insertBefore(f, '#include <map_fragment>', 'vec4 surfDiagOut = vec4(0.0);')
      f = insertAfter(f, '#include <clearcoat_normal_fragment_maps>', sheetFragment)
      f = insertBefore(f, '#include <opaque_fragment>', 'if (surfDiag > 0.5) { outgoingLight = surfDiagOut.rgb; }')
      shader.fragmentShader = f
    },
  })
}

/** Rubber by its look: dark, rough and not metal. */
export function looksLikeRubber(material: THREE.Material): boolean {
  const m = material as THREE.MeshStandardMaterial
  if (m.roughness === undefined || m.metalness === undefined || !m.color) return false
  const l = 0.2126 * m.color.r + 0.7152 * m.color.g + 0.0722 * m.color.b
  return m.metalness < 0.3 && m.roughness > 0.6 && l < 0.08
}
