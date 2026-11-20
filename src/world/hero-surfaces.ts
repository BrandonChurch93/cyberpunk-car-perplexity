import * as THREE from 'three'
import { config } from '../config'
import { stream } from '../core/random'
import { insertAfter, patchMaterial } from '../materials/patch'

const opalVertex = /* glsl */ `
  varying vec2 face;
  void main() { face = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
const noise = /* glsl */ `
  float hash21(vec2 p) {
    vec3 q=fract(p.xyx*.1031);
    q+=dot(q,q.yzx+33.33);
    return fract((q.x+q.y)*q.z);
  }
  float field(vec2 p) {
    vec2 a=floor(p), f=fract(p);
    f=f*f*(3.0-2.0*f);
    return mix(mix(hash21(a),hash21(a+vec2(1,0)),f.x),mix(hash21(a+vec2(0,1)),hash21(a+1.0),f.x),f.y);
  }
`

export function towerSurface(id: string, level: number, distant: boolean): THREE.MeshStandardMaterial {
  const r = stream(`world/hero/tower/${id}`)
  const cell = new THREE.Vector2(r.range(.64, .91), r.range(3.28, 3.72))
  const density = r.range(.38, .57)
  const seed = r.range(0, 61)
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(level * .37, level * .46, level * .56),
    roughness: .48, metalness: .32,
  })
  patchMaterial(mat, {
    id: 'hero tower cladding and window rooms',
    uniforms: { bay: { value: cell }, roomDensity: { value: density }, salt: { value: seed }, farRoom: { value: distant ? 1 : 0 } },
    apply(shader) {
      shader.vertexShader = insertAfter(shader.vertexShader, '#include <common>', 'varying vec2 wallUv; varying float wallSide;')
      shader.vertexShader = insertAfter(shader.vertexShader, '#include <project_vertex>', /* glsl */ `
        wallUv=vec2(mix(position.x,position.z,abs(normal.x)),position.y);
        wallSide=1.0-abs(normal.y);
      `)
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <common>', /* glsl */ `
        varying vec2 wallUv;
        varying float wallSide;
        uniform vec2 bay;
        uniform float roomDensity, salt, farRoom;
        ${noise}
      `)
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <color_fragment>', /* glsl */ `
        vec2 grid = wallUv/bay + vec2(salt,fract(salt)*.74+.13);
        vec2 cell = floor(grid), p = fract(grid);
        float seam = 1.0-smoothstep(.009,.043+fwidth(grid.y),min(p.y,1.0-p.y));
        float wash = field(wallUv*vec2(6.4,.42)+salt)*field(wallUv*vec2(2.1,.43));
        float rind = field(wallUv*3.8);
        vec2 aa=clamp(fwidth(grid),vec2(.001),vec2(.21));
        float shutter = hash21(vec2(floor(cell.x*.5),floor(cell.y*.68))+salt);
        float roomId = hash21(cell+salt);
        float rowPower = hash21(vec2(floor(cell.x*.33),cell.y*.98)+salt*.38);
        vec2 sash=vec2(.233+.089*shutter,.084+.047*roomId);
        vec2 win=1.0-smoothstep(sash-aa,sash+aa,abs(p-vec2(.5,.59+.043*shutter)));
        float frame = wallSide*win.x*win.y;
        float visionGlass = wallSide*(1.0-smoothstep(.445,.48+aa.x,abs(p.x-.5)))*
          (1.0-smoothstep(.24,.29+aa.y,abs(p.y-.60)));
        float mullion = mix(.26,1.0,smoothstep(.024,.070 + aa.x,abs(p.x-.49)));
        float lamp = smoothstep(roomDensity-.068,roomDensity+.11,rowPower*.28+roomId*.72) * step(.07,shutter);
        vec2 lampOffset = (p-vec2(.31+shutter*.36,.665))*vec2(4.5,9.5);
        float interior = .27+.59*exp(-dot(lampOffset,lampOffset))+.19*p.y;
        float glass = frame*mullion*mix(.62,1.0,smoothstep(.49,.62,p.y+roomId*.06));
        float darkCurtain = .64+.36*field(vec2(cell.x*.55,p.y*.8+salt));
        diffuseColor.rgb *= (.53 + .27*rind - .18*seam - .28*wash)*mix(darkCurtain,.26,visionGlass);
      `)
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <emissivemap_fragment>', /* glsl */ `
        vec3 warm = mix(vec3(1.27,.58,.169),vec3(1.19,.80,.389),roomId);
        vec3 roomTint = mix(warm,vec3(.49,.69,.96),smoothstep(.93,.995,roomId));
        totalEmissiveRadiance += glass*lamp*interior*roomTint*(.46+roomId*.94);
        totalEmissiveRadiance += mix(vec3(.005,.007,.012),vec3(.013,.017,.028),farRoom)
          *(1.0-.65*frame)*mix(.62,1.27,visionGlass);
      `)
    },
  })
  return mat
}

export function billboardMural(width: number, height: number, magenta: THREE.Color) {
  const violet = new THREE.Color(.165,.061,2.39)
  const shade = new THREE.Color()
  const uniforms = { flow: { value: new THREE.Vector2(1,0) }, pixelCount: { value: new THREE.Vector2(width / .041, height / .041) }, magenta: { value: magenta }, violet: { value: violet } }
  const material = new THREE.ShaderMaterial({
    uniforms, toneMapped: false, vertexShader: opalVertex,
    fragmentShader: /* glsl */ `
      varying vec2 face;
      uniform vec2 flow, pixelCount;
      uniform vec3 magenta, violet;
      ${noise}
      void main() {
        vec2 p = face*vec2(3.8,3.1)+flow*.31;
        float field0 = field(p*1.21);
        float field1 = field(p*2.14+field0*.78);
        float veil = field(p*4.09+vec2(0.0,.54));
        float sweep = smoothstep(.23,.84,face.x - .54*(face.y-.56) + .14*(field0-.5));
        float bend = (face.x-.45-.57*(face.y-.48)+.22*(field1-.5))*3.9;
        float ribbon = exp(-bend*bend);
        float curl = smoothstep(.37,.77,field0*.51+field1*.31+.20*ribbon+.13*face.y);
        float speed = .83+.15*flow.x;
        float edge = smoothstep(.008,.032,face.x)*(1.0-smoothstep(.969,.998,face.x));
        float footprint = max(fwidth(face.x)*pixelCount.x,fwidth(face.y)*pixelCount.y);
        float pixelAA = 1.0-smoothstep(.30,1.16,footprint);
        vec2 cells=face*pixelCount;
        vec2 cellEdge=abs(fract(cells)-.5);
        float diode=1.0-max(smoothstep(.31,.49,cellEdge.x),smoothstep(.34,.49,cellEdge.y));
        float level = (.58+.40*curl+.19*veil)*(.75+.25*edge)*mix(1.0,.68+.32*diode,pixelAA);
        vec3 led = mix(magenta, violet, sweep);
        led += (1.0-sweep)*vec3(.42,.035,.09)*smoothstep(.42,.76,field1)*ribbon;
        led *= 1.0-.25*smoothstep(.45,.84,sweep)*(1.0-speed*curl);
        gl_FragColor = vec4(led*level,1.0);
      }
    `,
  })
  const phase = (time: number) => time * 2 * Math.PI / config.film.durationSeconds
  return {
    material,
    set(time: number) {
      const a = phase(time), y = Math.sin(a)
      uniforms.flow.value.set(Math.cos(a), Math.abs(y) < 1e-14 ? 0 : y)
    },
    colorAt(time: number, color: THREE.Color) {
      shade.copy(magenta).lerp(violet, .44 + .034 * Math.sin(phase(time)))
      color.copy(shade).multiplyScalar(1 / shade.r)
    },
    level(time: number) { return .86 + .12 * Math.cos(phase(time)) },
  }
}

export function signGlass(glyphs: THREE.Texture, tint: THREE.Color, width: number, height: number, backlit: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    toneMapped: false,
    uniforms: { glyphs: { value: glyphs }, tint: { value: tint }, scatterStep: { value: new THREE.Vector2(.031/width,.028/height) },
      backing: { value: backlit ? .087 : .010 } },
    vertexShader: opalVertex,
    fragmentShader: /* glsl */ `
      varying vec2 face;
      uniform sampler2D glyphs;
      uniform vec3 tint;
      uniform vec2 scatterStep;
      uniform float backing;
      void main(){
        float glyph=texture2D(glyphs,face).a;
        float bleed=0.0;
        for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++)
          bleed+=texture2D(glyphs,face+vec2(float(x),float(y))*scatterStep).a;
        vec2 vignette=1.0-abs(face-.5)*2.0;
        float rim=smoothstep(.013,.21,min(vignette.x,vignette.y));
        gl_FragColor=vec4(vec3(.009,.012,.016)+tint*(rim*backing+.155*bleed/9.0+1.13*glyph),1.0);
      }`,
  })
}

export function fixtureOpal(color: THREE.Color, segments: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    toneMapped: false, vertexShader: opalVertex,
    uniforms: { tint: { value: color }, segments: { value: segments } },
    fragmentShader: /* glsl */ `
      varying vec2 face;
      uniform vec3 tint;
      uniform float segments;
      void main() {
        vec2 d=abs(face-.5);
        float rim=1.0-smoothstep(.42,.51,max(d.x,d.y));
        float seam=1.0;
        if (segments>1.0) {
          float t=face.y*segments;
          seam=.085+.915*smoothstep(.026,.098+fwidth(t),abs(fract(t+.5)-.5));
        }
        float diffusion=.74+.26*cos((face.x-.5)*2.4);
        gl_FragColor=vec4(tint*(.12+.88*rim)*seam*diffusion,1);
      }
    `,
  })
}
