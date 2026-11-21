import * as THREE from 'three'
import { stream } from '../core/random'
import { group, type Tuple } from './forms'

type Roof = { at: number; span: number; depth: number; rise: number; aerial: number; plant: 'stack' | 'flow' | 'relay' }

const roofs: Record<string, Roof> = {
  'hero middle west distance': { at: .14, span: .65, depth: .27, rise: 4.8, aerial: 0, plant: 'flow' },
  'hero far west distance': { at: .19, span: .56, depth: .26, rise: 8.8, aerial: 6.1, plant: 'relay' },
  'hero middle center distance': { at: .11, span: .61, depth: .21, rise: 4.2, aerial: 0, plant: 'stack' },
  'hero far center distance': { at: -.14, span: .55, depth: .24, rise: 7.2, aerial: 0, plant: 'flow' },
  'far inner west glass crown': { at: .16, span: .51, depth: .22, rise: 5.2, aerial: 0, plant: 'flow' },
  'far central recessed slab': { at: -.17, span: .53, depth: .33, rise: 9.4, aerial: 9, plant: 'relay' },
  'c9 center kiln tower': { at: -.13, span: .68, depth: .49, rise: 5.4, aerial: 0, plant: 'stack' },
  'c9 center fluted offices': { at: .14, span: .65, depth: .42, rise: 5.7, aerial: 0, plant: 'flow' },
  'c9 center upper lift': { at: -.15, span: .56, depth: .39, rise: 6.5, aerial: 4.3, plant: 'relay' },
  'c9 center distant crown': { at: .14, span: .62, depth: .43, rise: 4.6, aerial: 0, plant: 'stack' },
}

export function articulateSouthTowers(root: THREE.Group): void {
  const layout = root.getObjectByName('hero tower layout')
  if (!layout) return
  const zinc = new THREE.MeshStandardMaterial({
    color: new THREE.Color(.050,.055,.063),
    emissive: new THREE.Color(.010,.012,.020),
    roughness: .68,
    metalness: .33,
  })
  const lens = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.31,.051,.088), toneMapped: false })
  const add = (parent: THREE.Object3D, name: string, at: Tuple, size: Tuple, material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size),material)
    mesh.name = name
    mesh.position.set(...at)
    parent.add(mesh)
  }
  for (const volume of layout.children) {
    const shell = volume.children[0]
    if (!(shell instanceof THREE.Mesh) || !(shell.geometry instanceof THREE.BoxGeometry) || Array.isArray(shell.material)) continue
    const roof = roofs[shell.name]
    if (!roof) continue
    const { width, height, depth } = shell.geometry.parameters
    const top = shell.position.y+height*.5
    const { x, z } = shell.position
    const stage = group(volume,'terraced mechanical crown',[x,top,z])
    const rx = roof.at*width
    const rw = roof.span*width
    const dz = depth*.205
    const rd = depth*roof.depth
    const pivot = Math.sign(rx)
    const r = stream(`world/hero/roof plant/${shell.name}`)
    add(stage,'recessed service floor',[rx,roof.rise*.5-.16,dz],[rw,roof.rise+.32,rd],shell.material)
    add(stage,'standing seam service roof',[rx,roof.rise,dz],[rw+.36,.36,rd+.38],zinc)
    const upperSide = rx-pivot*rw*.17
    const upperSpan = rw*(roof.plant === 'flow' ? .47 : .61)
    const upperRise = roof.rise*(roof.plant === 'relay' ? .47 : .27)
    add(stage,'setback upper riser',[upperSide,roof.rise+upperRise*.5,dz-rd*.11],[upperSpan,upperRise,rd*.54],shell.material)
    if (roof.plant === 'flow') {
      for (const sign of [-1,1]) {
        const px = rx+sign*rw*.31
        add(stage,'air plant cowling',[px,roof.rise+.83,dz+rd*.19],[rw*.18,1.66,rd*.28],zinc)
        add(stage,'weather hood intake lip',[px,roof.rise+1.84,dz+rd*.18],[rw*.22,.36,rd*.34],zinc)
      }
    } else if (roof.plant === 'stack') {
      for (const align of [-.31,.24]) {
        const stack = r.range(1.9,3.7)
        const flue = rw*r.range(.09,.14)
        add(stage,'paired boiler flue',[rx+rw*align,roof.rise+stack*.5,dz+rd*.13],[flue,stack,flue],zinc)
        add(stage,'capped flue hood',[rx+rw*align,roof.rise+stack,dz+rd*.13],[flue+.36,.28,flue+.36],zinc)
      }
    } else {
      const tip = roof.rise+upperRise+roof.aerial
      const start = roof.rise+upperRise
      add(stage,'socketed communication mast',[upperSide,(start+tip)*.5,dz-rd*.11],[.39,roof.aerial,.42],zinc)
      add(stage,'asymmetric antenna spreader',[upperSide+rw*.08,tip-.94,dz-rd*.11],[rw*.44,.19,.18],zinc)
      add(stage,'shielded antenna lens',[upperSide,tip+.19,dz-rd*.11],[.53,.39,.47],lens)
    }
  }
}
