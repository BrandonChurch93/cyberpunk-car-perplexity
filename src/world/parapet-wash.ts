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
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <roughnessmap_fragment>', /* glsl */ `
        float formX = wallP.x/2.35;
        float panelCut = abs(fract(formX+.5)-.5);
        float panelJoint = 1.0-smoothstep(.005,.016+fwidth(formX)*.56,panelCut);
        float shutterStep = roofNoise(vec2(floor(formX+.5),7.6));
        float flow = roofNoise(vec2(wallP.x*13.8+shutterStep*.43,wallP.y*.84));
        float seep = roofNoise(vec2(wallP.x*5.1,wallP.y*2.8));
        float hangingRunoff = smoothstep(.40,.78,flow*.69+seep*.31)*smoothstep(.05,.65,1.044-wallP.y);
        float baseSoak = (1.0-smoothstep(.045,.32,wallP.y))*(.43+.57*roofNoise(wallP*vec2(6.1,11.7)));
        diffuseColor.rgb *= max(.42,1.026+.21*(shutterStep-.5)-.34*panelJoint-.33*hangingRunoff-.13*baseSoak);
        roughnessFactor = clamp(roughnessFactor-.095*hangingRunoff-.07*baseSoak,.48,1.0);
      `)
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <lights_fragment_end>', /* glsl */ `
        float wallDepth = dot(vRoofWorld.xz, parapetFront);
        float frontWall = smoothstep(parapetFace-.077,parapetFace-.005,wallDepth);
        float splash = 0.0;
        for (int i=0;i<${strips.length};i++) {
          vec4 strip = parapetStrip[i];
          vec2 stripDelta = wallP-strip.xy;
          float down = max(0.0,-stripDelta.y);
          float up = max(0.0,stripDelta.y);
          bool west = strip.x<0.0;
          float breadth = (west ? .32 : .20)+down*(west ? 1.03 : .87);
          float across = max(abs(stripDelta.x)-strip.w*.92,0.0)/breadth;
          float beam = exp(-across*across);
          float foot = (1.0-.54*smoothstep(.26,.60,down))/(1.0+down*down*(west ? 10.5 : 18.0));
          float cutoff = 1.0-smoothstep(.018,west ? .208 : .122,up);
          float bank = west ? 8.6 : 4.0;
          splash += bank*beam*foot*cutoff*(.70+.42*smoothstep(-.022,.07,-stripDelta.y))*strip.z;
        }
        reflectedLight.indirectDiffuse += diffuseColor.rgb*vec3(9.3,7.7,5.2)*splash*frontWall;
      `)
    },
  })
}
