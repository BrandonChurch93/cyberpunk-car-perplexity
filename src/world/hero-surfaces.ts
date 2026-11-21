import * as THREE from 'three'
import { config } from '../config'
import { stream } from '../core/random'
import { insertAfter, insertBefore, patchMaterial } from '../materials/patch'
import { muralMean, muralPainting, muralRise, muralRows, pictureLookup } from './mural-picture'

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

const bayPitches: Record<Facade, readonly [number, number, number, number]> = {
  curtain: [1.54,1.80,3.30,3.60],
  concrete: [1.33,1.53,3.18,3.39],
  banded: [1.39,1.70,3.02,3.18],
  hotel: [1.44,1.67,3.06,3.25],
}

export function towerSurface(id: string, level: number, facade: Facade, screen: ScreenReflection, spills: readonly SignSpill[], layer: FacadeLayer, frontageDistance: number): THREE.MeshStandardMaterial {
  const r = stream(`world/hero/tower/${id}`)
  const north = /^north /.test(id)
  const nearRing = !north && layer === 'near'
  const hotelBlock = /^hero (?:(?:hotel|parking|bar) tower|near west garage bay)$/.test(id)
  const windowScale = nearRing ? .5 : 1
  const [w0,w1,h0,h1] = bayPitches[facade]
  const cell = north
    ? new THREE.Vector2(layer === 'near' ? r.range(1.63,1.79) : r.range(1.29,1.77),r.range(3.12,3.58))
    : new THREE.Vector2(r.range(w0,w1),r.range(h0,h1))
  const organization = stream(`world/hero/tenancy/${id}`)
  const tenantRhythm = north ? new THREE.Vector4(4,3,1,0) : new THREE.Vector4(
    (facade === 'hotel' ? 2.8 : facade === 'banded' ? 3.2 : 4.6)+organization.range(0,2.8),
    (facade === 'hotel' ? 1.8 : facade === 'banded' ? 4.4 : 2.4)+organization.range(0,1.5),
    organization.range(.66,1.36), organization.range(.07,.97),
  )
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
  const windowPitch = cell.clone().multiplyScalar(windowScale)
  const enamel = nearRing ? hotelBlock ? new THREE.Color(.36,.57,.60) : new THREE.Color(.71,.81,.84) : new THREE.Color(1,1,1)
  const facadeTint = /left edge|hotel tower|parking tower|west garage|west distance/.test(id)
    ? new THREE.Color(.72,1.03,1.12) : /right edge|amber tower|east garage/.test(id) ? new THREE.Color(1.15,1.00,.87) :
      new THREE.Color(.96,.98,1.08)
  const centerBank = /middle (west|center) distance|far (center|central|inner west)|center (exchange|clock|fluted|kiln|upper|communication|distant)|rear middle|hero (violet|bar) tower|tower setback glass wing/.test(id)
  const crownMist = !north && layer !== 'near' && /far center|center upper lift|center distant crown|rear middle/.test(id)
    ? new THREE.Vector3(111+8*tenantRhythm.w,137+7*tenantRhythm.z,.51+.17*tenantRhythm.w)
    : new THREE.Vector3(0,1,0)
  const reflectedVeil = layer === 'near' ? new THREE.Color(0,0,0)
    : centerBank ? new THREE.Color(.190,.126,.163)
    : /east|outer skyline/.test(id) ? new THREE.Color(.030,.038,.068) : new THREE.Color(.014,.015,.024)
  const west = /left edge|hotel tower|parking tower|west garage|west distance|c9 west/.test(id)
  const westOffices = Number(/left edge|hotel tower|parking tower|west garage/.test(id))
  const eastFrontage = /amber tower|east garage/.test(id)
  const garageReturn = Number(id === 'hero near west garage bay')
  const shadowWash = centerBank
    ? layer === 'near' ? new THREE.Color(.106,.075,.117).multiplyScalar(id.includes('glass wing') ? 1.42 : 1) : new THREE.Color(.115,.084,.129)
    : new THREE.Color(.175,.138,.184).multiplyScalar(garageReturn)
  const roomPhotometry = new THREE.Vector3(westOffices,eastFrontage ? .72 : 1,eastFrontage ? .80 : 1)
  const windowContrast = (layer === 'near' ? .87 : layer === 'middle' ? .72 : .48) * (west ? 1.08 : 1)
  const stripFloors = /left edge|west garage/.test(id)
  const amberRisers = id === 'hero amber tower'
  const hotelFrontage = id === 'hero hotel tower'
  const southRooms = north ? 0 : 1
  const tenantFill = new THREE.Vector2(
    southRooms * (hotelFrontage ? .91 : amberRisers ? .82 : centerBank ? .77 : .36),
    hotelFrontage ? .75 : amberRisers ? .43 : centerBank ? .69 : .54,
  )
  const streetFront = /left edge|hotel tower|west garage|amber tower|right edge|east garage/.test(id)
  const leasing = new THREE.Vector2(
    north ? 0 : streetFront ? west ? .93 : .83 : layer === 'near' ? .49 : .63,
    north ? 0 : streetFront ? west ? .32 : .35 : layer === 'near' ? .19 : .06,
  )
  const claddingShade = amberRisers ? .71 : 1
  const tenantGate = layer === 'near' ? new THREE.Vector3(.078,.46,.73) : layer === 'middle'
    ? new THREE.Vector3(.11,.50,.78) : new THREE.Vector3(.16,.57,.84)
  const windowTail = layer === 'far' ? 0 : west ? 98+8*westOffices
    : /amber tower|right edge|east garage/.test(id) ? 29
    : /screen tower|bar tower|center exchange|center clock|center fluted/.test(id) ? 32 : 12
  const skylineAir = north ? new THREE.Vector3() : new THREE.Vector3(
    1, centerBank ? .84 : west ? .21 : .40, west ? .13 : .19,
  )
  const spill = (i: number) => spills[i] ?? { point: new THREE.Vector3(), size: new THREE.Vector2(1,1), color: new THREE.Color(0,0,0) }
  const prefix = 'varying vec2 wallUv, wallUnit, wallFacing; varying vec3 wallPoint, wallNormal, wallTangent; varying float wallSide;'
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(level*.14,level*.16,level*.20).multiply(enamel).multiplyScalar(claddingShade*(1-.70*leasing.y)),
    roughness: facade === 'concrete' ? .79 : facade === 'hotel' ? .58 : .39,
    metalness: facade === 'concrete' ? .08 : facade === 'hotel' ? .24 : .42,
  })
  mat.userData.moduleMeters = cell.toArray()
  mat.userData.windowPitchMeters = windowPitch.toArray()
  mat.userData.enamel = enamel.toArray()
  mat.userData.tenantRhythm = tenantRhythm.toArray()
  mat.userData.facade = facade
  mat.userData.distanceLayer = layer
  mat.userData.crownMist = crownMist.toArray()
  mat.userData.clearPaneWidth = paneHalfWidth*2*windowPitch.x
  mat.userData.litOpeningMeters = clearOpening.multiplyScalar(windowScale).toArray()
  mat.userData.mechanicalFloorPitch = mechanicalPitch
  mat.userData.roomDepthMeters = roomDepthMeters.toArray()
  mat.userData.tenantGate = tenantGate.toArray()
  mat.userData.tenantFill = tenantFill.toArray()
  mat.userData.leasing = leasing.toArray()
  mat.userData.windowContrast = windowContrast
  mat.userData.skylineAir = skylineAir.toArray()
  patchMaterial(mat, {
    id: 'hero tower cladding and window rooms',
    uniforms: {
      bay: { value: windowPitch }, roomDepthMeters: { value: roomDepthMeters }, salt: { value: seed }, facadeFamily: { value: family },
      tenantRhythm: { value: tenantRhythm }, crownMist: { value: crownMist },
      shellLuma: { value: level }, whiteBalance: { value: whiteBalance },
      paneHalfWidth: { value: paneHalfWidth }, litOpening: { value: litOpening },
      facadeTint: { value: facadeTint }, reflectedVeil: { value: reflectedVeil }, windowTail: { value: windowTail }, claddingShade: { value: claddingShade },
      shadowWash: { value: shadowWash }, garageReturn: { value: garageReturn }, roomPhotometry: { value: roomPhotometry },
      windowContrast: { value: windowContrast }, amberRisers: { value: Number(amberRisers) }, westGlaze: { value: Number(west && layer === 'near') },
      skylineAir: { value: skylineAir }, enamel: { value: enamel }, windowScale: { value: windowScale },
      mechanicalPitch: { value: mechanicalPitch }, distanceLayer: { value: layer === 'near' ? 0 : layer === 'middle' ? 1 : 2 },
      stripFloors: { value: stripFloors ? 1 : 0 }, tenantGate: { value: tenantGate }, tenantFill: { value: tenantFill }, leasing: { value: leasing },
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
        wallFacing=max(normal.xz,vec2(0.0));
        wallSide=1.0-abs(normal.y);
        wallPoint=(modelMatrix*vec4(position,1.0)).xyz;
        wallNormal=normalize(mat3(modelMatrix)*normal);
        wallTangent=normalize(mat3(modelMatrix)*vec3(1.0-abs(normal.x),0.0,abs(normal.x)));
      `)
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <common>', /* glsl */ `
        ${prefix}
        uniform vec2 bay, roomDepthMeters, litOpening, tenantFill, leasing;
        uniform vec4 tenantRhythm;
        uniform vec3 crownMist;
        uniform float salt, facadeFamily, shellLuma, whiteBalance, mechanicalPitch, distanceLayer, stripFloors, windowTail, windowContrast, paneHalfWidth, claddingShade, amberRisers, westGlaze, garageReturn;
        uniform vec3 screenPoint,screenNormal,facadeTint,reflectedVeil,screenSpill,tenantGate,shadowWash,roomPhotometry;
        uniform vec3 skylineAir, enamel;
        uniform float windowScale;
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
        float apertureCoverage(vec2 p,vec2 halfPane,vec2 footprint) {
          vec2 radius=.5*max(footprint,vec2(.001));
          vec2 upper=min(p+radius,halfPane);
          vec2 lower=max(p-radius,-halfPane);
          vec2 visible=max(upper-lower,0.0)/(2.0*radius);
          return visible.x*visible.y;
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
        vec2 wallGrid=wallUv/bay+vec2(salt,fract(salt)*.74+.13)/windowScale;
        vec2 roomCell=floor(wallGrid), pane=fract(wallGrid);
        vec2 leaseCell=floor(roomCell*windowScale);
        float closeRing=step(windowScale,.75);
        vec2 pixelFootprint=fwidth(wallGrid);
        vec2 aa=clamp(pixelFootprint*.68,vec2(.002),vec2(.29));
        vec2 glazingAA=clamp(pixelFootprint*vec2(1.54,1.14),vec2(.002),vec2(.44,.34));
        vec2 lightAA=clamp(pixelFootprint*vec2(.85,.72),vec2(.002),vec2(.35,.27));
        float surfaceDetail=1.0-smoothstep(.52,1.53,max(pixelFootprint.x,pixelFootprint.y));
        float roomId=hash21(roomCell+salt);
        float exposure=hash21(roomCell.yx+salt*1.77);
        float roomTintId=hash21(roomCell+vec2(salt*2.25,17.2));
        float run=floor(leaseCell.y/tenantRhythm.x+tenantRhythm.w);
        float stack=hash21(vec2(run,salt));
        float floorState=hash21(vec2(leaseCell.y,salt*1.21));
        float hotel=step(2.5,facadeFamily);
        float tenantWidth=tenantRhythm.y+floor((5.0-hotel*2.0)*hash21(vec2(run+19.0,salt)));
        float tenant=floor((leaseCell.x+stack*7.0)/tenantWidth);
        float suite=hash21(vec2(tenant,leaseCell.y)+salt*.53);
        float tenantStack=hash21(vec2(tenant,run)+salt*.89);
        float concrete=1.0-step(.5,abs(facadeFamily-1.0));
        float banded=1.0-step(.5,abs(facadeFamily-2.0));
        float curtain=1.0-max(concrete,max(banded,hotel));
        float district=field(vec2(leaseCell.x/(tenantWidth*1.44),leaseCell.y*.164*tenantRhythm.z)+vec2(salt,salt*.63));
        float tenantOn=step(tenantGate.y+mix(.14,-.12,district),mix(suite,tenantStack,.61));
        float floorBlock=hash21(vec2(floor((leaseCell.y+salt*.41)/(hotel>0.0?5.0:7.0)),salt*1.83));
        float floorLease=1.0, leased=1.0;
        if (leasing.x>0.0) {
          floorLease=hash21(vec2(floor((leaseCell.y+salt*.77)/(2.0+floor(tenantRhythm.x*.54))),salt+42.1));
          float wingLease=hash21(vec2(floor((leaseCell.x+4.3*stack)/(1.9*tenantWidth)),run)+salt*1.37);
          float westFront=westGlaze*smoothstep(.72,.92,leasing.x);
          leased=smoothstep(.29+.05*westFront,.66+.07*westFront,.66*floorLease+.34*wingLease);
        }
        float quietWall=1.0-leased;
        float gridStrength=1.0-leasing.x*(.30+.57*quietWall);
        float occupied=step(tenantGate.x,floorState)*max(tenantOn*step(.14,roomId),step(.968,roomId));
        float broadTenant=step(tenantGate.z+.024*hotel,floorState)*step(.40,tenantStack)*step(.22,roomId);
        float mechanical=1.0-step(1.0,mod(leaseCell.y+floor(salt),mechanicalPitch));
        float switchedOn=mix(1.0,step(.39,hash21(roomCell+vec2(2.6,salt+53.0))),closeRing);
        float podium=(1.0-smoothstep(.56,.74,wallUnit.y));
        float accentRun=stripFloors*podium*step(.79,stack)*step(.28,suite);
        float occupiedWest=roomPhotometry.x*step(.76,floorState)*step(.65,tenantStack)*step(.42,roomId)*step(.52,suite)*(1.0-accentRun)*(1.0-mechanical)*switchedOn;
        float warmRiser=0.0, riserOpen=0.0;
        if (amberRisers>0.0) {
          warmRiser=hash21(vec2(floor(leaseCell.x*.48),salt+36.8));
          riserOpen=step(.27,warmRiser)*step(.38,roomId)*step(.10,floorState);
        }
        float lateLease=mix(suite,tenantStack,.57)+.13*(district-.5);
        float addedRoom=step(.76-.29*tenantFill.x,lateLease)*step(.73-.24*tenantFill.x,roomId);
        addedRoom*=step(.16,floorState)*step(.18,floorBlock)*smoothstep(.02,.29,tenantFill.x);
        float lamp=max(max(max(occupied,broadTenant),riserOpen),.92*addedRoom)*(1.0-mechanical)*mix(.56,1.0,smoothstep(.12,.54,floorBlock));
        float primeRoom=smoothstep(.86,.986,exposure)*step(.34,floorLease);
        lamp*=mix(1.0,max(leased,primeRoom),leasing.x)*switchedOn;
        float lobby=smoothstep(.71,.96,suite)*(1.0-smoothstep(.10,.27,wallUnit.y))*(.24+.76*tenantOn);
        float curtainBand=smoothstep(.74,.91,floorState)*smoothstep(.48,.84,district);
        vec2 width=vec2(paneHalfWidth,.325-.046*banded-.025*concrete);
        float glass=wallSide*windowMask(pane-vec2(.5,.55),width,glazingAA);
        float aperture=wallSide*windowMask(pane-vec2(.5,.583),litOpening,lightAA);
        float mullion=1.0-(.69-.32*concrete)*windowMask(pane-vec2(.5,.55),vec2(.024,.36),aa);
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
        float sill=wallSide*(1.0-smoothstep(.023,.045+aa.y,abs(pane.y-.216)));
        float pilaster=windowMask(vec2(fract(pane.x+.5)-.5,pane.y-.5),vec2(.025+.045*concrete,.499),aa);
        float rib=wallSide*windowMask(vec2(fract(wallGrid.x*windowScale*.25+.5)-.58,pane.y-.5),vec2(.024+.012*curtain,.499),aa);
        float unlitWest=westGlaze*(1.0-.83*lamp)*(.31+.69*glass);
        float wallMeasure=min(wallUnit.x,1.0-wallUnit.x);
        float corner=wallSide*(1.0-smoothstep(.008,.022+fwidth(wallUnit.x),wallMeasure));
        float panelGrain=field(wallUv*vec2(.89,.61)+salt);
        float panelPatina=field(wallUv*vec2(.21,.035)+salt*1.43);
        diffuseColor.rgb*=max(.12,.68+.19*panelGrain+.22*panelPatina+gridStrength*((.29*banded-.26)*spandrel-.37*pilaster-.30*rib-.55*glass)-.38*mechanical+.38*corner)*(1.0-.22*unlitWest);
      `)
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <emissivemap_fragment>', /* glsl */ `
        vec3 tungsten=mix(vec3(1.23,.66,.31),vec3(1.04,.92,.73),clamp(mix(roomTintId,tenantStack,.22)+(whiteBalance-.31),0.0,1.0));
        vec3 roomTint=mix(tungsten,vec3(.48,.75,1.16),smoothstep(.91,.98,roomId));
        float coldTenant=smoothstep(.66,.85,mix(roomTintId,tenantStack,.22))*tenantFill.y;
        roomTint=mix(roomTint,vec3(.55,.76,1.10),coldTenant*smoothstep(.01,.38,tenantFill.x));
        roomTint=mix(roomTint,vec3(1.07,.23,.65),step(.989,suite));
        roomTint=mix(roomTint,vec3(.042,.69,1.16),accentRun*.68);
        vec3 riserTint=mix(vec3(1.62,.102,.066),vec3(1.24,.57,.19),smoothstep(.58,.70,warmRiser));
        roomTint=mix(roomTint,riserTint,riserOpen*(.78+.16*roomTintId));
        vec3 closeWarm=mix(vec3(1.428,.596,.143),vec3(1.157,.661,.300),roomTintId);
        vec3 closeTint=mix(closeWarm,vec3(.721,.733,.870),smoothstep(.85,.94,roomId));
        roomTint=mix(roomTint,closeTint,closeRing);
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
        vec3 farVeil=reflectedVeil*max(.48,distanceLayer*.5)*(.78+.22*skyStain);
        float panelReflectance=max(.12,.54+.23*panelPatina+.12*panelGrain-.33*mechanical-gridStrength*(.24*spandrel+.30*rib+.34*glass+.17*pilaster));
        vec3 toScreen=screenPoint-wallPoint;
        float screenReach=sqrt(screenSize.x*screenSize.y)*1.36;
        vec3 muralDistance=toScreen*vec3(1.0,.71,1.0)/screenReach;
        float muralBounce=1.0/(1.0+dot(muralDistance,muralDistance));
        float muralFacing=.37+.63*max(0.0,dot(wallNormal,toScreen)/max(3.0,length(toScreen)));
        vec3 districtBounce=mix(vec3(.28,.26,.33),screenSpill,.46)*muralBounce*muralBounce*muralFacing*.24;
        float rank=distanceLayer*.5;
        vec3 cityBounce=mix(vec3(.074,.078,.092)*facadeTint,vec3(.064,.062,.087),rank);
        cityBounce*=claddingShade*(.54+.56*panelReflectance+.22*sqrt(faceOn))*(.84+.16*skyStain);
        vec3 spill=signGlow*(.19+.12*glass)+districtBounce*(.72+.52*panelReflectance);
        vec3 baseGlow=(claddingShade*envelope*skyGlass*panelReflectance+cityBounce+spill)*(1.0-.21*unlitWest)+farVeil;
        float baseLuma=dot(baseGlow,vec3(.2126,.7152,.0722));
        float shadow=(1.0-smoothstep(.053,mix(.146,.192,garageReturn),baseLuma))*(1.0-.71*lamp);
        float receive=mix(1.0,max(wallFacing.x,wallFacing.y*smoothstep(.77,.99,wallUnit.x)),garageReturn);
        float spillCompression=mix(1.0,roomPhotometry.z,smoothstep(.105,.260,baseLuma));
        baseGlow=baseGlow*spillCompression+shadowWash*shadow*receive*(.75+.33*panelReflectance)*(1.0-.35*mechanical-.21*rib);
        baseGlow*=enamel*(1.0-leasing.y*(.44+.56*quietWall));
        float offsetDistance=length((wallPoint-cameraPosition).xz);
        float nearTier=1.0-smoothstep(490.0,760.0,offsetDistance);
        float claddingExposure=smoothstep(.028,.092,baseLuma)*(1.0-.79*lamp);
        totalEmissiveRadiance+=wallSide*baseGlow*(1.0-skylineAir.x*skylineAir.z*nearTier*claddingExposure);
        totalEmissiveRadiance+=(gridStrength*(sill+pilaster*.14)+corner*.44)*enamel*skyGlass*(.53+.19*floorState)*(.52+.59*curtain+.35*banded);
        float lampRadiance=.46+1.64*exposure*exposure+mix(10.8,3.9,rank)*pow(exposure,10.0)+.39*windowTail*pow(exposure,17.0)+riserOpen*(.53+1.4*exposure);
        float roomCompression=mix(roomPhotometry.y,1.0,smoothstep(.86,.99,exposure));
        lampRadiance*=roomCompression*(1.0-.30*roomPhotometry.x*(1.0-smoothstep(.77,.98,exposure)));
        lampRadiance*=1.0+westGlaze*smoothstep(.72,.92,leasing.x)*mix(-.17,.19,smoothstep(.68,.96,exposure));
        lampRadiance*=mix(1.0,.78,closeRing);
        lampRadiance+=tenantFill.x*(.14+.30*exposure)*(.70+.30*rank);
        roomTint=mix(roomTint,vec3(.66,.65,.83),rank*.48);
        vec3 litRoom=roomTint*lamp*lampRadiance*roomLight*windowContrast;
        vec3 subpixelRooms=mix(vec3(.126,.104,.092),vec3(.082,.085,.112),rank)*(1.0-mechanical);
        totalEmissiveRadiance+=glass*(.28+.75*curtain+.28*banded)*
          (enamel*gridStrength*claddingShade*skyGlass*(.23+(1.0-faceOn)*.35)+screenGlass*screenMirror*.37)*(1.0-.59*mechanical)*(1.0-.25*unlitWest);
        if (tenantFill.x>.01) {
          vec2 opening=litOpening*mix(vec2(1.014,1.021),vec2(1.048,1.095),tenantFill.x);
          float coverage=apertureCoverage(pane-vec2(.5,.583),opening,pixelFootprint);
          float groupLevel=smoothstep(.23,.76,tenantStack)*(.62+.38*floorBlock);
          float meanLamp=mix(.090,.45,groupLevel)*(.85+.45*tenantFill.x)*(1.0-.79*mechanical)*mix(1.0,.39+.61*leased,leasing.x);
          meanLamp*=mix(1.0,.67,closeRing);
          vec3 groupTint=mix(vec3(1.18,.83,.55),vec3(.59,.80,1.10),smoothstep(.72,.98,tenantStack)*tenantFill.y);
          groupTint=mix(groupTint,mix(vec3(1.292,.629,.221),vec3(.721,.733,.870),smoothstep(.89,.99,tenantStack)),closeRing);
          vec3 averageRooms=groupTint*meanLamp*opening.x*opening.y*4.0;
          totalEmissiveRadiance+=wallSide*mix(averageRooms,coverage*mullion*litRoom,surfaceDetail);
        } else {
          totalEmissiveRadiance+=aperture*mullion*mix(subpixelRooms,litRoom,surfaceDetail);
        }
        vec2 officeHalf=min(width,litOpening*vec2(1.15,.97));
        float office=wallSide*windowMask(pane-vec2(.5,.583),officeHalf,lightAA);
        vec3 officeTint=mix(vec3(1.0,.80,.54),vec3(1.0,.96,.86),smoothstep(.52,.91,tenantStack));
        officeTint=mix(officeTint,closeTint,closeRing);
        totalEmissiveRadiance+=officeTint*office*mullion*occupiedWest*surfaceDetail*mix(1.0,max(.48,leased),leasing.x)*mix(1.0,.57,closeRing)*
          (12.0+46.0*exposure*exposure)*(.56+.44*roomLight);
        totalEmissiveRadiance+=wallSide*roomTint*(lobby*.12+curtainBand*.086)*(1.0-mechanical)*gridStrength*
          (1.0-smoothstep(.13,.25+lightAA.y,abs(pane.y-.56)));
      `)
      shader.fragmentShader = insertBefore(shader.fragmentShader, '#include <opaque_fragment>', /* glsl */ `
        if (crownMist.z>.0) {
          vec3 along=normalize(wallPoint-cameraPosition);
          float districtAngle=atan(along.x,-along.z)-atan(screenPoint.x,-screenPoint.z)+.114;
          float angleScale=districtAngle/.235;
          float uplight=exp(-angleScale*angleScale);
          float weather=field(wallPoint.xz*.014+vec2(wallPoint.y*.037,salt));
          float bankHeight=6.7*(weather-.5);
          float roofFade=crownMist.z*smoothstep(crownMist.x,crownMist.y,wallPoint.y+bankHeight);
          vec3 roofAir=mix(vec3(.084,.080,.118),vec3(.207,.102,.152),uplight);
          outgoingLight=mix(outgoingLight,roofAir,roofFade*(.76+.24*weather));
        }
        if (skylineAir.x>.0) {
          vec3 ray=wallPoint-cameraPosition;
          float lengthMeters=length(ray);
          float mistPath=max(lengthMeters-652.0,0.0);
          float strata=exp(-max(0.0,(wallPoint.y+cameraPosition.y)*.5-37.0)/144.0);
          float t=exp(-min(.66,mistPath*.00140*strata));
          vec3 heading=ray/max(1.0,lengthMeters);
          float sector=atan(heading.x,-heading.z)-atan(screenPoint.x,-screenPoint.z)+.158;
          float broad=exp(-sector*sector/.056);
          float veil=mix(.24,.85,broad)*skylineAir.y;
          vec3 filmAir=mix(vec3(.062,.078,.120),vec3(.179,.106,.156),veil);
          outgoingLight=outgoingLight*t+filmAir*(1.0-t);
        }
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
    rise: { value: picture ? muralRise : 1 }, rows: { value: picture ? muralRows : 1 },
  }
  const material = new THREE.ShaderMaterial({
    uniforms, toneMapped: false, vertexShader: opalVertex,
    fragmentShader: /* glsl */ `
      varying vec2 face;
      uniform vec2 flow, pixelCount, cabinetCount;
      uniform float cabinetSalt, banded, travel, relief, picture, artworkGain, rise, rows;
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
          led=muralPicture(artwork,face,flow,travel,rise,rows)*artworkGain;
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

export function fixtureOpal(color: THREE.Color, segments: number, shaped = false, gap = 0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    toneMapped: false, vertexShader: opalVertex,
    uniforms: { tint: { value: color }, segments: { value: segments }, shaped: { value: Number(shaped) }, gap: { value: gap } },
    fragmentShader: /* glsl */ `
      varying vec2 face;
      uniform vec3 tint;
      uniform float segments, shaped, gap;
      void main() {
        vec2 d=abs(face-.5);
        float rim=1.0-smoothstep(.42,.51,max(d.x,d.y));
        float seam=1.0;
        float shutter=1.0;
        if (segments>1.0) {
          float t=face.y*segments;
          float joint=abs(fract(t+.5)-.5);
          seam=.085+.915*smoothstep(.026,.098+fwidth(t),joint);
          if (gap>0.0) shutter=mix(.019,1.0,smoothstep(gap,gap+min(.065,.017+fwidth(t)),joint));
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
        gl_FragColor=vec4(lens*(.12+.88*rim)*seam*shutter,1);
      }
    `,
  })
}
