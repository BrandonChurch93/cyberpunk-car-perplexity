import * as THREE from 'three'
import { config } from '../config'
import { stream } from '../core/random'
import { insertAfter, patchMaterial } from '../materials/patch'
import { muralMean, muralPainting, pictureLookup } from './mural-picture'

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
export type ScreenReflection = { point: THREE.Vector3; normal: THREE.Vector3; size: THREE.Vector2; picture: ReturnType<typeof billboardMural>['picture']; spill: THREE.Color }
export type FacadeLayer = 'near' | 'middle' | 'far'

export function towerSurface(id: string, level: number, facade: Facade, screen: ScreenReflection, spills: readonly SignSpill[], layer: FacadeLayer, frontageDistance: number): THREE.MeshStandardMaterial {
  const r = stream(`world/hero/tower/${id}`)
  const cell = new THREE.Vector2(layer === 'near' ? r.range(1.63, 1.79) : r.range(1.29, 1.77), r.range(3.12, 3.58))
  const whiteBalance = r.range(.14, .48)
  const seed = r.range(0, 61)
  const mechanicalPitch = 15+r.int(11)
  const roomDepthMeters = new THREE.Vector2(4,8)
  const family = ({ curtain: 0, concrete: 1, banded: 2, hotel: 3 })[facade]
  const paneHalfWidth = .416 - (facade === 'concrete' || facade === 'hotel' ? .061 : 0) + (facade === 'banded' ? .012 : 0)
  const paneHalfHeight = .325 - (facade === 'concrete' ? .025 : facade === 'banded' ? .046 : 0)
  const clearOpening = new THREE.Vector2(
    Math.min(paneHalfWidth*2*cell.x,Math.max(.91,frontageDistance*.00221)),
    Math.min(paneHalfHeight*2*cell.y,THREE.MathUtils.clamp(frontageDistance*.00223,1.08,1.88)),
  )
  const litOpening = new THREE.Vector2(clearOpening.x/(2*cell.x),clearOpening.y/(2*cell.y))
  const facadeTint = /left edge|hotel tower|parking tower|west garage|west distance/.test(id)
    ? new THREE.Color(.72,1.03,1.12) : /right edge|amber tower|east garage/.test(id) ? new THREE.Color(1.15,1.00,.87) :
      new THREE.Color(.96,.98,1.08)
  const reflectedVeil = /east|outer skyline/.test(id) && layer !== 'near'
    ? new THREE.Color(.030,.038,.068) : new THREE.Color(.014,.015,.024)
  const stripFloors = /left edge|west garage/.test(id)
  const claddingShade = id === 'hero amber tower' ? .71 : 1
  const tenantGate = layer === 'near' ? new THREE.Vector3(.115,.428,.785) : layer === 'middle'
    ? new THREE.Vector3(.143,.477,.833) : new THREE.Vector3(.20,.550,.913)
  const windowTail = layer !== 'far' && /left edge|hotel tower|parking tower|west garage/.test(id) ? 94
    : layer !== 'far' && /amber tower|right edge|east garage/.test(id) ? 53
    : layer !== 'far' && /screen tower|bar tower|center exchange|center clock|center fluted/.test(id) ? 46 : 0
  const spill = (i: number) => spills[i] ?? { point: new THREE.Vector3(), size: new THREE.Vector2(1,1), color: new THREE.Color(0,0,0) }
  const prefix = 'varying vec2 wallUv, wallUnit; varying vec3 wallPoint, wallNormal, wallTangent; varying float wallSide;'
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(level*.14,level*.16,level*.20).multiplyScalar(claddingShade),
    roughness: facade === 'concrete' ? .79 : facade === 'hotel' ? .58 : .39,
    metalness: facade === 'concrete' ? .08 : facade === 'hotel' ? .24 : .42,
  })
  mat.userData.moduleMeters = cell.toArray()
  mat.userData.facade = facade
  mat.userData.distanceLayer = layer
  mat.userData.clearPaneWidth = paneHalfWidth*2*cell.x
  mat.userData.litOpeningMeters = clearOpening.toArray()
  mat.userData.mechanicalFloorPitch = mechanicalPitch
  mat.userData.roomDepthMeters = roomDepthMeters.toArray()
  mat.userData.tenantGate = tenantGate.toArray()
  patchMaterial(mat, {
    id: 'hero tower cladding and window rooms',
    uniforms: {
      bay: { value: cell }, roomDepthMeters: { value: roomDepthMeters }, salt: { value: seed }, facadeFamily: { value: family },
      shellLuma: { value: level }, whiteBalance: { value: whiteBalance },
      paneHalfWidth: { value: paneHalfWidth }, litOpening: { value: litOpening },
      facadeTint: { value: facadeTint }, reflectedVeil: { value: reflectedVeil }, windowTail: { value: windowTail }, claddingShade: { value: claddingShade },
      mechanicalPitch: { value: mechanicalPitch }, distanceLayer: { value: layer === 'near' ? 0 : layer === 'middle' ? 1 : 2 },
      stripFloors: { value: stripFloors ? 1 : 0 }, tenantGate: { value: tenantGate },
      screenPoint: { value: screen.point }, screenNormal: { value: screen.normal }, screenSize: { value: screen.size },
      screenSpill: { value: screen.spill },
      screenInk: screen.picture.artwork, screenFlow: screen.picture.flow, screenTravel: screen.picture.travel, screenGain: screen.picture.artworkGain,
      spillPoint: { value: [spill(0).point,spill(1).point] }, spillSize: { value: [spill(0).size,spill(1).size] },
      spillTint: { value: [spill(0).color,spill(1).color] },
    },
    apply(shader) {
      shader.vertexShader = insertAfter(shader.vertexShader, '#include <common>', prefix)
      shader.vertexShader = insertAfter(shader.vertexShader, '#include <project_vertex>', /* glsl */ `
        wallUv=vec2(mix(position.x,position.z,abs(normal.x)),position.y);
        wallUnit=uv;
        wallSide=1.0-abs(normal.y);
        wallPoint=(modelMatrix*vec4(position,1.0)).xyz;
        wallNormal=normalize(mat3(modelMatrix)*normal);
        wallTangent=normalize(mat3(modelMatrix)*vec3(1.0-abs(normal.x),0.0,abs(normal.x)));
      `)
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <common>', /* glsl */ `
        ${prefix}
        uniform vec2 bay, roomDepthMeters, litOpening;
        uniform float salt, facadeFamily, shellLuma, whiteBalance, mechanicalPitch, distanceLayer, stripFloors, windowTail, paneHalfWidth, claddingShade;
        uniform vec3 screenPoint,screenNormal,facadeTint,reflectedVeil,screenSpill,tenantGate;
        uniform vec3 spillPoint[2],spillTint[2];
        uniform vec2 screenSize,spillSize[2];
        uniform sampler2D screenInk;
        uniform vec2 screenFlow;
        uniform float screenTravel,screenGain;
        ${noise}
        ${pictureLookup}
        float windowMask(vec2 p,vec2 halfPane,vec2 aa) {
          vec2 w=1.0-smoothstep(halfPane-aa,halfPane+aa,abs(p));
          return w.x*w.y;
        }
        float interior(vec2 pane, vec2 viewSlope, vec2 aa, float depth, float fixture, float room) {
          vec2 low=vec2(.021,.165), high=vec2(.979,.902);
          vec2 start=clamp(pane,low+.001,high-.001);
          vec2 inset=-viewSlope;
          vec2 bound=mix(low,high,step(vec2(0.0),inset));
          vec2 exitDistance=abs(bound-start)*bay/max(abs(inset),vec2(.0001));
          float distanceIn=min(depth,min(exitDistance.x,exitDistance.y));
          vec2 hit=start+inset*distanceIn/bay;
          float horizontal=step(exitDistance.y,min(exitDistance.x,depth));
          float ceiling=horizontal*step(0.0,inset.y);
          float back=step(depth,min(exitDistance.x,exitDistance.y));
          vec2 fixtureCenter=vec2(.35+.29*fixture,.42+fixture*.95+room*.12);
          vec2 opening=vec2(.24+.095*room,.28+.38*fixture);
          vec2 filterWidth=min(vec2(.27,.46),vec2(aa.x*1.1,aa.y*bay.y/max(abs(inset.y),.17)));
          float troffer=windowMask(vec2(hit.x,distanceIn)-fixtureCenter,opening,filterWidth);
          vec2 toLight=(vec2(hit.x,distanceIn)-fixtureCenter)*vec2(1.7,.57);
          float bounce=1.0/(1.0+dot(toLight,toLight));
          float darkerFloor=mix(1.0,.46,horizontal-ceiling);
          float returnWall=.22+.44*bounce+.17*hit.y+.10*back;
          float reveal=smoothstep(.02,.34,distanceIn);
          return (returnWall*darkerFloor+ceiling*.98*troffer)*(.58+.42*reveal);
        }
      `)
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <color_fragment>', /* glsl */ `
        vec2 wallGrid=wallUv/bay+vec2(salt,fract(salt)*.74+.13);
        vec2 roomCell=floor(wallGrid), pane=fract(wallGrid);
        vec2 pixelFootprint=fwidth(wallGrid);
        vec2 aa=clamp(pixelFootprint*.68,vec2(.002),vec2(.29));
        vec2 glazingAA=clamp(pixelFootprint*vec2(1.54,1.14),vec2(.002),vec2(.44,.34));
        vec2 lightAA=clamp(pixelFootprint*vec2(.85,.72),vec2(.002),vec2(.35,.27));
        float surfaceDetail=1.0-smoothstep(.52,1.53,max(pixelFootprint.x,pixelFootprint.y));
        float roomId=hash21(roomCell+salt);
        float exposure=hash21(roomCell.yx+salt*1.77);
        float roomTintId=hash21(roomCell+vec2(salt*2.25,17.2));
        float run=floor(roomCell.y*.25);
        float stack=hash21(vec2(run,salt));
        float floorState=hash21(vec2(roomCell.y,salt*1.21));
        float hotel=step(2.5,facadeFamily);
        float tenantWidth=3.0+floor((5.0-hotel*2.0)*hash21(vec2(run+19.0,salt)));
        float tenant=floor((roomCell.x+stack*7.0)/tenantWidth);
        float suite=hash21(vec2(tenant,roomCell.y)+salt*.53);
        float tenantStack=hash21(vec2(tenant,run)+salt*.89);
        float concrete=1.0-step(.5,abs(facadeFamily-1.0));
        float banded=1.0-step(.5,abs(facadeFamily-2.0));
        float curtain=1.0-max(concrete,max(banded,hotel));
        float tenantOn=step(tenantGate.y,mix(suite,tenantStack,.63));
        float occupied=step(tenantGate.x,floorState)*max(tenantOn*step(.095,roomId),step(.976,roomId));
        float broadTenant=step(tenantGate.z+.024*hotel,floorState)*step(.075,roomId);
        float mechanical=1.0-step(1.0,mod(roomCell.y+floor(salt),mechanicalPitch));
        float podium=(1.0-smoothstep(.56,.74,wallUnit.y));
        float accentRun=stripFloors*podium*step(.79,stack)*step(.28,suite);
        float lamp=max(occupied,broadTenant)*(1.0-mechanical);
        vec2 width=vec2(paneHalfWidth,.325-.046*banded-.025*concrete);
        float glass=wallSide*windowMask(pane-vec2(.5,.55),width,glazingAA);
        float aperture=wallSide*windowMask(pane-vec2(.5,.583),litOpening,lightAA);
        float mullion=1.0-(.53-.24*concrete)*windowMask(pane-vec2(.5,.55),vec2(.017,.36),aa);
        vec3 toEye=normalize(cameraPosition-wallPoint);
        float faceOn=max(dot(toEye,wallNormal),.08);
        vec2 viewSlope=vec2(dot(toEye,wallTangent),toEye.y)/faceOn;
        float roomPlan=hash21(roomCell+vec2(5.1,salt));
        float roomDepth=mix(roomDepthMeters.x,roomDepthMeters.y,roomPlan);
        float blindBottom=.55+width.y*(1.0-2.0*mix(.15,.63,roomPlan));
        float blindHalf=step(.56,roomTintId)*smoothstep(blindBottom-aa.y,blindBottom+aa.y,pane.y);
        float slats=1.0-smoothstep(.29,.47,abs(fract((pane.y-blindBottom)*32.0)-.5));
        float slatAA=1.0-smoothstep(.24,1.04,pixelFootprint.y*32.0);
        float blind=.27-.12*slats*slatAA;
        float roomLight=mix(.46,mix(interior(pane,viewSlope,aa,roomDepth,roomTintId,roomId),blind,blindHalf),surfaceDetail);
        float spandrel=1.0-smoothstep(.093,.117+aa.y,abs(pane.y-.105));
        float sill=wallSide*(1.0-smoothstep(.016,.026+aa.y,abs(pane.y-.216)));
        float pilaster=windowMask(vec2(fract(pane.x+.5)-.5,pane.y-.5),vec2(.025+.045*concrete,.499),aa);
        float rib=wallSide*windowMask(vec2(fract((roomCell.x+pane.x)*.25+.5)-.58,pane.y-.5),vec2(.024+.012*curtain,.499),aa);
        float wallMeasure=min(wallUnit.x,1.0-wallUnit.x);
        float corner=wallSide*(1.0-smoothstep(.008,.022+fwidth(wallUnit.x),wallMeasure));
        float panelGrain=field(wallUv*vec2(.89,.61)+salt);
        float panelPatina=field(wallUv*vec2(.21,.035)+salt*1.43);
        diffuseColor.rgb*=max(.12,.68+.19*panelGrain+.22*panelPatina+(.29*banded-.26)*spandrel-.37*pilaster-.30*rib-.55*glass-.38*mechanical+.38*corner);
      `)
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <emissivemap_fragment>', /* glsl */ `
        vec3 tungsten=mix(vec3(1.28,.61,.23),vec3(1.10,.91,.67),clamp(mix(roomTintId,tenantStack,.22)+(whiteBalance-.31),0.0,1.0));
        vec3 roomTint=mix(tungsten,vec3(.48,.75,1.16),smoothstep(.91,.98,roomId));
        roomTint=mix(roomTint,vec3(1.07,.23,.65),step(.989,suite));
        roomTint=mix(roomTint,vec3(.042,.69,1.16),accentRun*.68);
        vec3 reflected=reflect(-toEye,wallNormal);
        float brightSky=smoothstep(.005,.235,reflected.y);
        float citySheen=pow(max(0.0,dot(reflected,normalize(vec3(.27,.12,.95)))),3.0);
        vec3 skyGlass=mix(vec3(.010,.015,.022),vec3(.074,.062,.088),brightSky)*facadeTint;
        skyGlass*=.55+.45*citySheen;
        vec3 screenAxis=vec3(screenNormal.z,0.0,-screenNormal.x);
        float planeCos=dot(reflected,screenNormal);
        float screenT=dot(screenPoint-wallPoint,screenNormal)/(-max(-planeCos,.001));
        vec3 screenHit=wallPoint+reflected*screenT-screenPoint;
        vec2 screenUV=vec2(dot(screenHit,screenAxis),screenHit.y)/screenSize;
        float screenMirror=step(2.0,screenT)*step(planeCos,-.02)*
          (1.0-smoothstep(.29,.91,max(abs(screenUV.x),abs(screenUV.y))));
        vec3 screenGlass=muralPicture(screenInk,clamp(screenUV+.5,0.0,1.0),screenFlow,screenTravel)*screenGain*.078;
        vec3 signGlow=vec3(0.0);
        for (int signIndex=0;signIndex<2;signIndex++) {
          vec3 signDelta=wallPoint-spillPoint[signIndex];
          vec2 signRadius=spillSize[signIndex]*vec2(.52,.68)+vec2(9.5+spillSize[signIndex].y*.11,11.6);
          float dy=signDelta.y/signRadius.y;
          float colorWash=1.0/(1.0+dot(signDelta.xz,signDelta.xz)/(signRadius.x*signRadius.x)+dy*dy);
          float facing=.34+.66*max(0.0,-dot(wallNormal,signDelta)/max(2.0,length(signDelta)));
          signGlow+=spillTint[signIndex]*colorWash*colorWash*facing;
        }
        float envelope=.18+.13*distanceLayer+.31*shellLuma;
        float skyStain=smoothstep(.25,.91,wallUnit.y);
        vec3 farVeil=reflectedVeil*(distanceLayer*.5)*(.78+.22*skyStain);
        float panelReflectance=max(.12,.47+.25*panelPatina+.13*panelGrain-.22*spandrel-.33*mechanical-.32*rib-.22*glass);
        vec3 toScreen=screenPoint-wallPoint;
        float screenReach=sqrt(screenSize.x*screenSize.y)*1.36;
        vec3 muralDistance=toScreen*vec3(1.0,.71,1.0)/screenReach;
        float muralBounce=1.0/(1.0+dot(muralDistance,muralDistance));
        float muralFacing=.37+.63*max(0.0,dot(wallNormal,toScreen)/max(3.0,length(toScreen)));
        vec3 districtBounce=mix(vec3(.28,.26,.33),screenSpill,.46)*muralBounce*muralBounce*muralFacing*.24;
        float rank=distanceLayer*.5;
        vec3 cityBounce=mix(vec3(.058,.064,.077)*facadeTint,vec3(.041,.040,.066),rank);
        cityBounce*=claddingShade*(.64+.45*panelReflectance+.22*sqrt(faceOn))*(.84+.16*skyStain);
        vec3 spill=signGlow*(.19+.12*glass)+districtBounce*(.72+.52*panelReflectance);
        totalEmissiveRadiance+=wallSide*(claddingShade*envelope*skyGlass*panelReflectance+farVeil+cityBounce+spill);
        totalEmissiveRadiance+=(sill+pilaster*.32+corner*.44)*skyGlass*(.33+.16*floorState)*(.52+.59*curtain+.35*banded);
        float lampRadiance=.19+1.49*exposure*exposure+mix(12.3,5.4,rank)*pow(exposure,11.0)+.48*windowTail*pow(exposure,17.0);
        roomTint=mix(roomTint,vec3(.66,.65,.83),rank*.48);
        vec3 litRoom=roomTint*lamp*lampRadiance*roomLight;
        vec3 subpixelRooms=mix(vec3(.179,.121,.087),vec3(.101,.103,.152),rank)*(1.0-mechanical);
        totalEmissiveRadiance+=glass*(.28+.75*curtain+.28*banded)*
          (claddingShade*skyGlass*(.23+(1.0-faceOn)*.35)+screenGlass*screenMirror*.37)*(1.0-.59*mechanical);
        totalEmissiveRadiance+=aperture*mullion*mix(subpixelRooms,litRoom,surfaceDetail);
      `)
    },
  })
  return mat
}

type MuralProfile = { violet?: THREE.Color; offset?: number; banded?: number; travel?: number; laps?: number; relief?: number; picture?: boolean; artworkGain?: number }

export function billboardMural(width: number, height: number, magenta: THREE.Color, profile: MuralProfile = {}) {
  const { violet = new THREE.Color(.165,.061,2.39), offset = 0, banded = 0, travel = .071, laps = 1, relief = 0, picture = false, artworkGain = 0 } = profile
  const shade = new THREE.Color()
  const estimateFlow = new THREE.Vector2()
  let estimateTime = NaN
  let peak = 0
  const uniforms = {
    flow: { value: new THREE.Vector2(1,0) }, pixelCount: { value: new THREE.Vector2(width / .041, height / .041) },
    cabinetCount: { value: new THREE.Vector2(Math.round(width/3.12), Math.round(height/3.02)) },
    cabinetSalt: { value: stream('world/hero/mural modules').range(0,61) },
    magenta: { value: magenta }, violet: { value: violet }, banded: { value: banded },
    travel: { value: travel }, relief: { value: relief }, picture: { value: Number(picture) },
    artwork: { value: artworkGain > 0 ? muralPainting(picture) : null }, artworkGain: { value: artworkGain },
  }
  const material = new THREE.ShaderMaterial({
    uniforms, toneMapped: false, vertexShader: opalVertex,
    fragmentShader: /* glsl */ `
      varying vec2 face;
      uniform vec2 flow, pixelCount, cabinetCount;
      uniform float cabinetSalt, banded, travel, relief, picture, artworkGain;
      uniform sampler2D artwork;
      uniform vec3 magenta, violet;
      ${noise}
      ${pictureLookup}
      void main() {
        vec2 p=face-.5+flow*travel;
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
        vec2 cabinet=face*cabinetCount;
        vec2 limit=.5-abs(fract(cabinet)-.5);
        vec2 filterSize=clamp(fwidth(cabinet)*.62,vec2(.002),vec2(.25));
        vec2 joint=1.0-smoothstep(vec2(.008),vec2(.038)+filterSize,limit);
        vec2 banks=cabinet*vec2(6.0,5.0);
        float inBank=1.0-smoothstep(.34,.94,max(fwidth(banks.x),fwidth(banks.y)));
        float pitch=hash21(floor(banks)+cabinetSalt)*.049-.0245;
        float tile=.981+.079*hash21(floor(cabinet)+cabinetSalt)-.185*max(joint.x,joint.y)+inBank*pitch;
        float level=(1.06+.30*veil+.20*billow+.34*ribbon)*(.74+.26*edge)*tile*mix(1.0,.64+.36*diode,pixelAA);
        vec3 led=mix(magenta, violet, sweep);
        led+=(1.0-sweep)*vec3(.52,.047,.12)*ribbon;
        float stripe=abs(fract(curve*3.29+.45*billow+.32)-.5);
        float lightwell=1.0-smoothstep(.11,.21,stripe);
        float cap=smoothstep(.0,.13,face.y)*(1.0-smoothstep(.91,.996,face.y));
        led=mix(led,led*.81+vec3(.83,.44,1.27),banded*lightwell*.66);
        level*=mix(1.0,.065+.935*lightwell*cap,banded);
        if (artworkGain>0.0) {
          led=muralPicture(artwork,face,flow,travel)*artworkGain;
          level=tile*mix(1.0,.68+.32*diode,pixelAA)*mix(1.0,.12+.88*lightwell*cap,banded);
          if (picture>0.0) {
            vec2 driver=cells/8.0;
            vec2 footprint=fwidth(driver);
            vec2 pass=1.0-smoothstep(vec2(.32),vec2(.96),footprint);
            level*=1.0+dot(cos(driver*6.2831853),pass*vec2(.082,.061));
          }
        } else if (relief>0.0) {
          float silk=field(vec2(curve*2.87,p.y*1.86)+vec2(.78,2.08)+flow*.12);
          float sheen=ribbon*(.26+.74*smoothstep(.25,.76,silk));
          led+=vec3(.82,.26,.73)*sheen*relief;
          level*=1.0+relief*(.065+.69*sheen);
        }
        gl_FragColor = vec4(led*level,1.0);
      }
    `,
  })
  const phase = (time: number) => time * 2 * Math.PI / config.film.durationSeconds
  const pinned = phase(config.film.heroFrameSeconds)*(1-laps)+offset
  const pinX = Math.cos(pinned), pinY = Math.sin(pinned)
  const flowAt = (time: number, out: THREE.Vector2) => {
    const a = laps*phase(time), x = Math.cos(a), y = Math.sin(a)
    const c = Math.abs(x) < 1e-14 ? 0 : x, s = Math.abs(y) < 1e-14 ? 0 : y
    out.set(c*pinX-s*pinY,s*pinX+c*pinY)
  }
  const estimate = (time: number) => {
    if (time === estimateTime) return
    estimateTime = time
    flowAt(time,estimateFlow)
    muralMean(estimateFlow.x,estimateFlow.y,travel,shade)
    peak = Math.max(shade.r,shade.g,shade.b)
  }
  return {
    material, picture: uniforms,
    set(time: number) { flowAt(time,uniforms.flow.value) },
    colorAt(time: number, color: THREE.Color) {
      if (picture) {
        estimate(time)
        color.copy(shade).multiplyScalar(1 / peak)
      } else {
        shade.copy(magenta).lerp(violet, .44 + .034 * Math.sin(phase(time)))
        color.copy(shade).multiplyScalar(1 / shade.r)
      }
    },
    level(time: number) {
      const envelope = .86 + .12 * Math.cos(phase(time))
      if (!picture) return envelope
      estimate(time)
      return envelope*peak*artworkGain*.206
    },
  }
}

export function signGlass(glyphs: THREE.Texture, tint: THREE.Color, width: number, height: number, backlit: boolean, radiance = 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    toneMapped: false,
    uniforms: { glyphs: { value: glyphs }, tint: { value: tint }, scatterStep: { value: new THREE.Vector2(.031/width,.028/height) },
      backing: { value: backlit ? .087 : .010 }, radiance: { value: radiance } },
    vertexShader: opalVertex,
    fragmentShader: /* glsl */ `
      varying vec2 face;
      uniform sampler2D glyphs;
      uniform vec3 tint;
      uniform vec2 scatterStep;
      uniform float backing, radiance;
      void main(){
        float glyph=texture2D(glyphs,face).a;
        float bleed=0.0;
        for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++)
          bleed+=texture2D(glyphs,face+vec2(float(x),float(y))*scatterStep).a;
        vec2 vignette=1.0-abs(face-.5)*2.0;
        float rim=smoothstep(.013,.21,min(vignette.x,vignette.y));
        gl_FragColor=vec4(vec3(.009,.012,.016)+tint*(rim*backing+radiance*(.155*bleed/9.0+1.13*glyph)),1.0);
      }`,
  })
}

export function fixtureOpal(color: THREE.Color, segments: number, shaped = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    toneMapped: false, vertexShader: opalVertex,
    uniforms: { tint: { value: color }, segments: { value: segments }, shaped: { value: Number(shaped) } },
    fragmentShader: /* glsl */ `
      varying vec2 face;
      uniform vec3 tint;
      uniform float segments, shaped;
      void main() {
        vec2 d=abs(face-.5);
        float rim=1.0-smoothstep(.42,.51,max(d.x,d.y));
        float seam=1.0;
        if (segments>1.0) {
          float t=face.y*segments;
          seam=.085+.915*smoothstep(.026,.098+fwidth(t),abs(fract(t+.5)-.5));
        }
        float diffusion=.74+.26*cos((face.x-.5)*2.4);
        vec3 lens=tint*diffusion;
        if (shaped>.5) {
          float x=face.x-.5;
          float shoulder=exp(-16.9*x*x), core=exp(-123.0*x*x);
          float feed=.96+.04*cos(face.y*5.2);
          lens=(tint*(.28+.35*shoulder+.35*core)+tint.b*vec3(.081,.048,0.0)*core)*feed;
          seam=.61+.39*seam;
        }
        gl_FragColor=vec4(lens*(.12+.88*rim)*seam,1);
      }
    `,
  })
}
