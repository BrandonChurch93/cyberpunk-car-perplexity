import * as THREE from 'three'
import { heroCityYaw, type Tuple } from './forms'

export const heroLayoutEye: Tuple = [3.15, .79, 7.87]
const up = new THREE.Vector3(0,1,0)
const eye = new THREE.Vector3(...heroLayoutEye).applyAxisAngle(up,-heroCityYaw)

export const heroScale = {
  leftEdge: 6.19,
  leftBlade: 9.55,
  hotel: 14.2,
  parking: 15.14,
  westFrontage: 15.16,
  bar: 11.1,
  screen: 12.4,
  amber: 13,
  rightEdge: 6.4,
  rightBlade: 10.42,
  eastFrontage: 18.76,
  middleWest: 9.81,
  outerEast: 5.08,
  farWest: 2.85,
  farCentralWest: 2.47,
} as const

export function heroPoint([x,y,z]: Tuple, k: number): Tuple {
  return [eye.x+(x-eye.x)*k,eye.y+(y-eye.y)*k,eye.z+(z-eye.z)*k]
}

export function heroSize([x,y,z]: Tuple, k: number): Tuple {
  return [x*k,y*k,z*k]
}

export function heroFrontageDistance(x: number, z: number): number {
  return Math.hypot(x-eye.x,z-eye.z)
}

export function heroSightline(x: number, z: number, width: number, depth: number): boolean {
  const c = Math.cos(heroCityYaw), s = Math.sin(heroCityYaw)
  const forward = eye.z-z*c-x*s
  const lateral = x*c-z*s-eye.x
  const halfDepth = (width*s+depth*c)*.5
  const halfWidth = (width*c+depth*s)*.5
  return forward > halfDepth && Math.abs(lateral)-halfWidth < (forward+halfDepth)*.455
}
