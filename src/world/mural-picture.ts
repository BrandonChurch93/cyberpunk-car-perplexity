import * as THREE from 'three'
import { stream } from '../core/random'

const side = 384
const pictureSpan = .76
const driftScale = .42
const { lerp, smoothstep } = THREE.MathUtils
const floor = Math.floor
const ramp = (low: number, high: number, value: number) => smoothstep(value,low,high)

export const pictureLookup = /* glsl */ `
  vec3 muralPicture(sampler2D ink, vec2 uv, vec2 drift, float amount) {
    return texture2D(ink,.5+(uv-.5)*${pictureSpan}+drift*amount*${driftScale}).rgb;
  }
`

function paint() {
  const random = stream('world/hero/mural ink')
  const field = Float32Array.from({ length: 4096 }, () => random.next())
  const cell = (x: number, y: number) => field[(y & 63)*64+(x & 63)]
  const noise = (p: number, q: number) => {
    const x = floor(p), y = floor(q), sx = smoothstep(p-x,0,1), sy = smoothstep(q-y,0,1)
    return lerp(lerp(cell(x,y),cell(x+1,y),sx),lerp(cell(x,y+1),cell(x+1,y+1),sx),sy)
  }
  const pixels = new Uint16Array(side*side*4)
  const ink = new Float32Array(pixels.length)
  const hot = new THREE.Color(8.25,.375,3.50)
  const violet = new THREE.Color(1.11,.247,5.25)
  const indigo = new THREE.Color(.30,.111,1.12)
  const pale = new THREE.Color(2.25,1.14,2.98)
  const c = new THREE.Color()
  for (let i=0;i<side;i++) for (let j=0;j<side;j++) {
    const u = ((j+.5)/side-.5)/pictureSpan+.5
    const v = ((i+.5)/side-.5)/pictureSpan+.5
    const swirl = noise(u*3.74+8.13,v*2.83+12.7)
    const bend = noise(u*6.24+4.2,v*4.12+16.3)
    const x = u+.21*(swirl-.5)+.066*(bend-.5)
    const y = v+.16*(bend-.5)
    const warp = Math.sin(4.45*x+1.4*y)
    const fold = x+.32*(y-.5)+.079*warp+.064*Math.sin(y*10.7-x*5.73)
    const billow = noise(x*4.42+10.65,y*3.49+7.1)
    const grain = .51*noise(11.9*x+y*4.2+6.8,y*5.55+10.6)+.32*noise(x*23.0+21.6,y*17.2+3.9)+.17*noise(x*52.1-6.4,y*38.5+18.0)
    const ledge = y-.73*(x-.37)+.058*Math.sin(x*12.8+2.1)+.086*(billow-.5)
    const dark = (1-ramp(-.024,.103,ledge))*ramp(.38,.59,x)
    const silk = ramp(.24,.72,billow*.61+grain*.39)
    const pinched = Math.sin(fold*31.5+.91*warp+1.37*bend)
    const troughs = ramp(.37,.96,pinched)*ramp(.24,.55,fold)*(1-ramp(.81,.99,fold))
    const thread = 1-ramp(.006,.042,Math.abs(ledge-.122+.024*Math.sin(18*x)))
    const fringe = 1-ramp(.009,.026,Math.abs(ledge-.278+.065*Math.sin(x*6.8+1.3)))
    const streak = ramp(.52,.77,grain*.59+.41*bend)*(thread*.63+fringe*.31)*ramp(.27,.53,x)
    c.copy(hot).lerp(violet,ramp(.20,.75,fold))
    c.multiplyScalar((.86+.39*silk)*(1-.44*troughs*(.54+.46*grain)))
    c.lerp(indigo,dark*.94)
    c.r += pale.r*streak
    c.g += pale.g*streak
    c.b += pale.b*streak
    const k = (i*side+j)*4
    ink[k] = c.r
    ink[k+1] = c.g
    ink[k+2] = c.b
    ink[k+3] = 1
    for (let n=0;n<4;n++) pixels[k+n] = THREE.DataUtils.toHalfFloat(ink[k+n])
  }
  const texture = new THREE.DataTexture(pixels,side,side,THREE.RGBAFormat,THREE.HalfFloatType)
  texture.name = 'animated mural ink'
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return { texture, ink }
}

let painting: ReturnType<typeof paint> | undefined
export function muralPainting() { return (painting ??= paint()).texture }

export function muralMean(shiftX: number, shiftY: number, travel: number, out: THREE.Color): THREE.Color {
  const { ink } = (painting ??= paint())
  const x0 = .5+shiftX*travel*driftScale, y0 = .5+shiftY*travel*driftScale
  let r=0, g=0, b=0
  const count = 24
  for (let i=0;i<count;i++) for (let j=0;j<count;j++) {
    const x = floor((x0+((j+.5)/count-.5)*pictureSpan)*side)
    const y = floor((y0+((i+.5)/count-.5)*pictureSpan)*side)
    const k = (y*side+x)*4
    r+=ink[k]; g+=ink[k+1]; b+=ink[k+2]
  }
  return out.setRGB(r/(count*count),g/(count*count),b/(count*count))
}

export const muralLuma = ({ r,g,b }: THREE.Color) => .2126*r+.7152*g+.0722*b
