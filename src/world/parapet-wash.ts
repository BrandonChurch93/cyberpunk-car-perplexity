import * as THREE from 'three'
import { insertAfter, patchMaterial } from '../materials/patch'
import { heroCityYaw, type Tuple } from './forms'

type Strip = { at: Tuple; size: readonly [number,number] }

export function washHeroParapet(material: THREE.MeshStandardMaterial, faceZ: number, strips: readonly Strip[]) {
  material.color.setRGB(.225,.218,.203)
  const front = new THREE.Vector2(Math.sin(heroCityYaw),Math.cos(heroCityYaw))
  patchMaterial(material, {
    id: 'parapet opal downwash',
    uniforms: {
      parapetFront: { value: front },
      parapetFace: { value: faceZ },
      parapetStrip: { value: strips.map(({at, size})=>new THREE.Vector4(at[0],at[1],at[2]-faceZ,size[0]*.5)) },
    },
    apply(shader) {
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <common>', /* glsl */ `
        uniform vec2 parapetFront;
        uniform float parapetFace;
        uniform vec4 parapetStrip[${strips.length}];
      `)
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <lights_fragment_end>', /* glsl */ `
        float wallDepth = dot(vRoofWorld.xz, parapetFront);
        float frontWall = smoothstep(parapetFace-.077,parapetFace-.005,wallDepth);
        float splash = 0.0;
        for (int i=0;i<${strips.length};i++) {
          vec4 strip = parapetStrip[i];
          vec2 stripDelta = wallP-strip.xy;
          float down = max(0.0,-stripDelta.y);
          float breadth = 0.12+down*.72;
          float across = max(abs(stripDelta.x)-strip.w*.72,0.0)/breadth;
          float beam = exp(-across*across);
          float foot = 1.0/(1.0+down*down*26.0);
          float cutoff = 1.0-smoothstep(-.028,.055,stripDelta.y);
          float bank = strip.x<0.0 ? 1.64 : 1.21;
          splash += bank*beam*foot*cutoff*(1.0+.42*smoothstep(.015,.11,down))*strip.z;
        }
        reflectedLight.indirectDiffuse += diffuseColor.rgb*vec3(8.8,7.0,4.65)*splash*frontWall;
      `)
    },
  })
}
