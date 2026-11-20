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
  const cell = new THREE.Vector2(r.range(.39, .91), r.range(.66, 1.14))
  const density = r.range(.31, .59)
  const seed = r.range(0, 61)
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(level * .66, level * .72, level * .81),
    roughness: .76, metalness: .13,
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
        vec2 grid = wallUv/bay + vec2(salt,.23);
        vec2 cell = floor(grid), p = fract(grid);
        float seam = 1.0-smoothstep(.008,.032+fwidth(grid.y),min(p.y,1.0-p.y));
        float wash = field(wallUv*vec2(6.4,.54)+salt)*field(wallUv*vec2(2.1,.73));
        float rind = field(wallUv*3.8);
        vec2 aa=clamp(fwidth(grid),vec2(.001),vec2(.21));
        vec2 win=1.0-smoothstep(vec2(.28,.24)-aa,vec2(.28,.24)+aa,abs(p-vec2(.5,.59)));
        float frame = wallSide*win.x*win.y;
        float mullion = smoothstep(.036,.064 + aa.x,abs(p.x-.49));
        float shutter = hash21(vec2(floor(cell.x*.5),floor(cell.y*.68))+salt);
        float roomId = hash21(cell+salt);
        float rowPower = hash21(vec2(floor(cell.x*.33),cell.y*.98)+salt*.38);
        float lamp = smoothstep(roomDensity,roomDensity+.14,rowPower*.54+roomId*.46) * step(.15,shutter);
        vec2 lampOffset = (p-vec2(.31+shutter*.36,.79))*vec2(4.5,3.5);
        float interior = .28+.45*exp(-dot(lampOffset,lampOffset))+.22*p.y;
        float glass = frame*mullion*mix(.62,1.0,smoothstep(.37,.61,p.y+roomId*.12));
        diffuseColor.rgb *= (.74 + .24*rind - .39*seam - .30*wash)*(1.0-.70*frame);
      `)
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <emissivemap_fragment>', /* glsl */ `
        vec3 warm = mix(vec3(1.25,.54,.16),vec3(1.10,.83,.49),roomId);
        vec3 roomTint = mix(warm,vec3(.59,.82,1.04),smoothstep(.89,.98,roomId));
        totalEmissiveRadiance += glass*lamp*interior*roomTint*(.28+roomId*.91);
        totalEmissiveRadiance += mix(vec3(.018,.018,.026),vec3(.029,.031,.042),farRoom)*(1.0-.73*frame);
      `)
    },
  })
  return mat
}

export function billboardMural(width: number, height: number) {
  const magenta = new THREE.Color(3.48,.145,1.46)
  const violet = new THREE.Color(.42,.117,3.71)
  const shade = new THREE.Color()
  const uniforms = { flow: { value: new THREE.Vector2(1,0) }, pixelCount: { value: new THREE.Vector2(width / .008, height / .008) }, magenta: { value: magenta }, violet: { value: violet } }
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
        float sweep = smoothstep(.21,.81,face.x - .31*(face.y-.56) + .17*(field0-.5));
        float bend = (face.x-.39-.37*(face.y-.48)+.24*(field1-.5))*3.4;
        float ribbon = exp(-bend*bend);
        float curl = smoothstep(.37,.77,field0*.51+field1*.31+.20*ribbon+.13*face.y);
        float speed = .83+.15*flow.x;
        float edge = smoothstep(.008,.032,face.x)*(1.0-smoothstep(.969,.998,face.x));
        float pixelAA = clamp(1.0-max(fwidth(face.x)*pixelCount.x,fwidth(face.y)*pixelCount.y),0.0,1.0);
        vec2 cells=face*pixelCount;
        vec2 cellEdge=abs(fract(cells)-.5);
        float diode=1.0-max(smoothstep(.31,.49,cellEdge.x),smoothstep(.34,.49,cellEdge.y));
        float level = (.60+.58*curl+.12*veil)*(.77+.23*edge)*mix(1.0,.62+.38*diode,pixelAA);
        vec3 led = mix(magenta, violet, sweep);
        led += (1.0-sweep)*vec3(.51,.09,.12)*smoothstep(.50,.86,field1)*ribbon;
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
