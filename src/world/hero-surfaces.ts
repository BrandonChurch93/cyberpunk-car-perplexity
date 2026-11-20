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

export type Facade = 'curtain' | 'concrete' | 'banded' | 'hotel'
export type SignSpill = { point: THREE.Vector3; size: THREE.Vector2; color: THREE.Color }
export type ScreenReflection = { point: THREE.Vector3; normal: THREE.Vector3; size: THREE.Vector2 }

export function towerSurface(id: string, level: number, facade: Facade, screen: ScreenReflection, spill?: SignSpill): THREE.MeshStandardMaterial {
  const r = stream(`world/hero/tower/${id}`)
  const cell = new THREE.Vector2(r.range(1.23, 1.76), r.range(3.12, 3.58))
  const density = r.range(.14, .48)
  const seed = r.range(0, 61)
  const family = ({ curtain: 0, concrete: 1, banded: 2, hotel: 3 })[facade]
  const facadeTint = /left edge|hotel tower|parking tower|west garage|bar tower|west distance/.test(id)
    ? new THREE.Color(.59,1.10,1.35) : new THREE.Color(.99,1.08,1.15)
  const prefix = 'varying vec2 wallUv; varying vec3 wallPoint, wallNormal, wallTangent; varying float wallSide;'
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(level * .40, level * .49, level * .60),
    roughness: .50, metalness: .25,
  })
  mat.userData.moduleMeters = cell.toArray()
  mat.userData.facade = facade
  patchMaterial(mat, {
    id: 'hero tower cladding and window rooms',
    uniforms: {
      bay: { value: cell }, roomDensity: { value: density }, salt: { value: seed }, facadeFamily: { value: family }, shellLuma: { value: level },
      facadeTint: { value: facadeTint },
      screenPoint: { value: screen.point }, screenNormal: { value: screen.normal }, screenSize: { value: screen.size },
      spillPoint: { value: spill?.point ?? new THREE.Vector3() }, spillSize: { value: spill?.size ?? new THREE.Vector2(1,1) },
      spillTint: { value: spill?.color ?? new THREE.Color(0,0,0) },
    },
    apply(shader) {
      shader.vertexShader = insertAfter(shader.vertexShader, '#include <common>', prefix)
      shader.vertexShader = insertAfter(shader.vertexShader, '#include <project_vertex>', /* glsl */ `
        wallUv=vec2(mix(position.x,position.z,abs(normal.x)),position.y);
        wallSide=1.0-abs(normal.y);
        wallPoint=(modelMatrix*vec4(position,1.0)).xyz;
        wallNormal=normalize(mat3(modelMatrix)*normal);
        wallTangent=normalize(mat3(modelMatrix)*vec3(1.0-abs(normal.x),0.0,abs(normal.x)));
      `)
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <common>', /* glsl */ `
        ${prefix}
        uniform vec2 bay;
        uniform float roomDensity, salt, facadeFamily, shellLuma;
        uniform vec3 screenPoint,screenNormal,spillPoint,spillTint,facadeTint;
        uniform vec2 screenSize,spillSize;
        ${noise}
        float windowMask(vec2 p,vec2 halfPane,vec2 aa) {
          vec2 w=1.0-smoothstep(halfPane-aa,halfPane+aa,abs(p));
          return w.x*w.y;
        }
      `)
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <color_fragment>', /* glsl */ `
        vec2 wallGrid=wallUv/bay+vec2(salt,fract(salt)*.74+.13);
        vec2 roomCell=floor(wallGrid), pane=fract(wallGrid);
        vec2 pixelFootprint=fwidth(wallGrid);
        vec2 aa=clamp(pixelFootprint*.68,vec2(.002),vec2(.29));
        float surfaceDetail=1.0-smoothstep(.52,1.53,max(pixelFootprint.x,pixelFootprint.y));
        float roomId=hash21(roomCell+salt);
        float exposure=hash21(roomCell.yx+salt*1.77);
        float roomTintId=hash21(roomCell+vec2(salt*2.25,17.2));
        float run=floor(roomCell.y*.32);
        float stack=hash21(vec2(run,salt));
        float floorState=hash21(vec2(roomCell.y,salt*1.21));
        float suite=hash21(vec2(floor(roomCell.x*.23),roomCell.y)+salt*.53);
        float hotel=step(2.5,facadeFamily);
        float concrete=1.0-step(.5,abs(facadeFamily-1.0));
        float banded=1.0-step(.5,abs(facadeFamily-2.0));
        float curtain=1.0-max(concrete,max(banded,hotel));
        float threshold=roomDensity+mix(.48*stack+.21*suite,.38*floorState,hotel);
        float lamp=step(threshold,roomId)*mix(step(.14,floorState),step(.045,floorState),hotel);
        vec2 width=vec2(.444-.115*max(concrete,hotel)+.018*banded,.335-.092*banded-.032*concrete);
        float glass=wallSide*windowMask(pane-vec2(.5,.55),width,aa);
        float mullion=1.0-(.62-.33*concrete)*windowMask(pane-vec2(.5,.55),vec2(.020,.36),aa);
        vec3 toEye=normalize(cameraPosition-wallPoint);
        float faceOn=max(dot(toEye,wallNormal),.08);
        vec2 viewSlope=vec2(dot(toEye,wallTangent),toEye.y)/faceOn;
        float dw=2.8+exposure*.9;
        vec2 roomRay=pane-viewSlope*vec2(dw)/bay;
        vec2 liner=(pane-vec2(.5,.55))+vec2(.015,-.078);
        float depth=windowMask(roomRay-vec2(.5,.52),vec2(.46,.39),aa);
        float blind=1.0-(.52+.32*exposure)*smoothstep(.01,.06+aa.y,.29*roomTintId-liner.y);
        float warmth=clamp(1.04-length((roomRay-vec2(.33+exposure*.31,.72))*vec2(1.29,.98)),.13,1.0);
        float roomLight=mix(.60,.28+.78*warmth,mix(.28,depth,surfaceDetail));
        roomLight*=mix(.69,blind,surfaceDetail);
        float spandrel=1.0-smoothstep(.025,.115+aa.y,abs(fract(pane.y+.5)-.5));
        float sill=wallSide*windowMask(pane-vec2(.5,.232),vec2(width.x,.027),aa);
        float pilaster=1.0-smoothstep(.008,.061+.053*concrete+aa.x,abs(fract(pane.x+.5)-.5));
        float panelGrain=field(wallUv*vec2(.89,.61)+salt);
        diffuseColor.rgb*=max(.15,.68+.32*panelGrain+(.41*banded-.31)*spandrel-.23*pilaster-.54*glass);
      `)
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <emissivemap_fragment>', /* glsl */ `
        vec3 tungsten=mix(vec3(1.31,.46,.102),vec3(1.06,.85,.49),roomTintId);
        vec3 roomTint=mix(tungsten,vec3(.40,.75,1.16),smoothstep(.88,.98,roomTintId));
        vec3 reflected=reflect(-toEye,wallNormal);
        vec3 skyGlass=mix(vec3(.024,.039,.060),vec3(.068,.045,.071),smoothstep(-.28,.17,reflected.y))*facadeTint;
        vec3 screenAxis=vec3(screenNormal.z,0.0,-screenNormal.x);
        float planeCos=dot(reflected,screenNormal);
        float screenT=dot(screenPoint-wallPoint,screenNormal)/(-max(-planeCos,.001));
        vec3 screenHit=wallPoint+reflected*screenT-screenPoint;
        vec2 screenUV=vec2(dot(screenHit,screenAxis),screenHit.y)/screenSize;
        float screenMirror=step(2.0,screenT)*step(planeCos,-.02)*
          (1.0-smoothstep(.29,.91,max(abs(screenUV.x),abs(screenUV.y))));
        vec3 screenGlass=mix(vec3(.39,.031,.128),vec3(.064,.027,.32),smoothstep(-.41,.47,screenUV.x));
        vec3 signDelta=(wallPoint-spillPoint);
        vec2 signRadius=spillSize*.48+vec2(3.6,5.2);
        float dy=signDelta.y/signRadius.y;
        float colorWash=1.0/(1.0+dot(signDelta.xz,signDelta.xz)/(signRadius.x*signRadius.x)+dy*dy);
        totalEmissiveRadiance+=wallSide*((.44+shellLuma*.61)*skyGlass*(.72+.32*panelGrain-.34*spandrel)*
          mix(vec3(1.0),vec3(.86,1.21,1.41),1.0-smoothstep(-.61,.21,wallNormal.x))+
          spillTint*colorWash*colorWash*(.11+.09*glass));
        totalEmissiveRadiance+=sill*skyGlass*(.55+.38*floorState)*(.57+.92*curtain+.4*banded);
        totalEmissiveRadiance+=glass*((.32+.68*curtain+.32*banded)*
          (skyGlass*(.30+(1.0-faceOn)*.33)+screenGlass*screenMirror*.68)+
          mullion*mix(roomTint*lamp*(.52+2.66*exposure*exposure)*roomLight,
            vec3(.31,.23,.17)*(.70-floorState*.20),1.0-surfaceDetail));
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
        vec2 p=face-.5+flow*.071;
        float billow=field(p*2.05+vec2(.73,1.48));
        float curve=p.x-.58*p.y+.28*(billow-.5);
        float sweep=smoothstep(-.35,.46,curve);
        float ribbonAxis=(curve+.15)*5.4;
        float ribbon=exp(-ribbonAxis*ribbonAxis);
        float veil=field(p*3.34+vec2(1.13,-.64));
        float edge = smoothstep(.008,.032,face.x)*(1.0-smoothstep(.969,.998,face.x));
        float footprint = max(fwidth(face.x)*pixelCount.x,fwidth(face.y)*pixelCount.y);
        float pixelAA = 1.0-smoothstep(.30,1.16,footprint);
        vec2 cells=face*pixelCount;
        vec2 cellEdge=abs(fract(cells)-.5);
        float diode=1.0-max(smoothstep(.31,.49,cellEdge.x),smoothstep(.34,.49,cellEdge.y));
        float slab=1.0-.046*smoothstep(.42,.49,abs(fract(face.y*6.0)-.5));
        float level=(1.06+.30*veil+.20*billow+.34*ribbon)*(.74+.26*edge)*slab*mix(1.0,.64+.36*diode,pixelAA);
        vec3 led=mix(magenta, violet, sweep);
        led+=(1.0-sweep)*vec3(.52,.047,.12)*ribbon;
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
