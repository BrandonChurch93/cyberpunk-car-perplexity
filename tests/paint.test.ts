import * as T from 'three'
import { describe, expect, it } from 'vitest'
import { config, paintById } from '../src/config'
import { patchesOf } from '../src/materials/patch'
import { palette } from '../src/vehicle/materials'

type Uniforms = Record<string, T.IUniform>

function compile(material: T.Material) {
  const shader = {
    vertexShader: T.ShaderLib.physical.vertexShader,
    fragmentShader: T.ShaderLib.physical.fragmentShader,
    uniforms: {} as Uniforms,
  }
  material.onBeforeCompile(shader as never, null as never)
  return shader
}

function state(u: Uniforms, paint: T.MeshPhysicalMaterial) {
  const v = (name: string) => (u[name].value as T.Vector4 | T.Color).toArray()
  return [v('carFlakeColor'), v('carBinder'), v('carFlakeShape'), v('carFlakeCell'), v('carCoat'), u.carFlakeSeed.value, paint.color.toArray()]
}

describe('paint stack', () => {
  const candidates = config.paint.candidates

  it('patches the full paint and leaves the blockout paint plain', () => {
    for (const spec of candidates) {
      expect(patchesOf(palette(spec, true).paint)).toContain('vehicle paint stack')
      expect(patchesOf(palette(spec, false).paint)).not.toContain('vehicle paint stack')
    }
  })

  it('compiles into the physical shader at every anchor', () => {
    const shader = compile(palette(paintById('black-pearl'), true).paint)
    expect(shader.fragmentShader).toContain('#define RE_Direct RE_Direct_Paint')
    expect(shader.fragmentShader).toContain('paintFlakeEnv(geometryNormal, geometryViewDir)')
    expect(shader.fragmentShader).toContain('clearcoatNormal = paintPeel(clearcoatNormal)')
    expect(shader.fragmentShader.indexOf('paintCells(')).toBeLessThan(shader.fragmentShader.indexOf('#include <lights_fragment_begin>'))
    expect(shader.vertexShader).toContain('carLocal = position;')
    for (const name of ['carFlakeColor', 'carBinder', 'carFlakeShape', 'carFlakeCell', 'carCoat', 'carFlakeSeed']) expect(shader.uniforms[name]).toBeDefined()
  })

  it('uses physical flake sizes, a fine pearl and coarser metallics', () => {
    const size = (id: string) => 2e6 * (compile(palette(paintById(id), true).paint).uniforms.carFlakeShape.value as T.Vector4).w
    for (const spec of candidates) {
      const s = size(spec.id)
      expect(s).toBeGreaterThanOrEqual(10)
      expect(s).toBeLessThanOrEqual(60)
    }
    expect(size('black-pearl')).toBeLessThan(size('ember-orange'))
    expect(size('black-pearl')).toBeLessThan(size('liquid-silver'))
  })

  it('deals at most six flakes per cell under a pixel and keeps tilt and peel slight', () => {
    for (const spec of candidates) {
      const u = compile(palette(spec, true).paint).uniforms
      const shape = u.carFlakeShape.value as T.Vector4
      const cell = u.carFlakeCell.value as T.Vector4
      const coat = u.carCoat.value as T.Vector4
      expect(shape.x * cell.x * cell.x).toBeLessThanOrEqual(6 + 1e-9)
      expect(cell.x).toBeLessThanOrEqual(90e-6)
      expect(cell.x).toBeGreaterThan(2 * shape.w)
      expect(T.MathUtils.radToDeg(shape.y)).toBeLessThan(12)
      expect(T.MathUtils.radToDeg(coat.x)).toBeLessThan(.1)
      expect(coat.y).toBeGreaterThanOrEqual(1e-3)
      expect(coat.y).toBeLessThanOrEqual(3e-3)
    }
  })

  it('conserves energy between base, flakes and clear', () => {
    for (const spec of candidates) {
      const m = palette(spec, true).paint
      const u = compile(m).uniforms
      const flake = u.carFlakeColor.value as T.Color
      const coverage = (u.carFlakeCell.value as T.Vector4).w
      for (const c of ['r', 'g', 'b'] as const) {
        expect(flake[c]).toBeLessThanOrEqual(1)
        expect(m.color[c] + flake[c] * coverage + .04).toBeLessThanOrEqual(1)
      }
      expect(m.metalness).toBe(0)
      expect(m.clearcoat).toBe(1)
      expect(m.clearcoatRoughness).toBeLessThan(.06)
    }
  })

  it('setPaint lands on the same state as a fresh palette, in any order', () => {
    const ids = candidates.map((c) => c.id)
    const p = palette(paintById(ids[0]), true)
    const u = compile(p.paint).uniforms
    for (const id of [...ids.slice(1), ...ids].reverse()) {
      p.setPaint(paintById(id))
      const fresh = palette(paintById(id), true)
      expect(state(u, p.paint)).toEqual(state(compile(fresh.paint).uniforms, fresh.paint))
    }
  })
})
