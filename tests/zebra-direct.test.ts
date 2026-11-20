import * as T from 'three'
import { describe, expect, it } from 'vitest'
import { patchesOf } from '../src/materials/patch'
import { zebraMirror } from '../src/core/reflect/zebra'

describe('zebra mirror', () => {
  it('shows the stripe environment and no lamp, so no highlight overflows the half float transmission buffer under water', () => {
    const mirror = zebraMirror()
    expect(patchesOf(mirror)).toContain('zebra stripes only')
    const shader = { vertexShader: T.ShaderLib.physical.vertexShader, fragmentShader: T.ShaderLib.physical.fragmentShader, uniforms: {} }
    mirror.onBeforeCompile(shader as never, null as never)
    const f = shader.fragmentShader
    const end = f.indexOf('#include <lights_fragment_end>')
    const out = f.indexOf('#include <opaque_fragment>')
    expect(end).toBeGreaterThan(0)
    const after = f.slice(end, out)
    expect(after).toMatch(/reflectedLight\.directSpecular = vec3\(0\.0\)/)
    expect(after).toMatch(/reflectedLight\.directDiffuse = vec3\(0\.0\)/)
    expect(mirror.metalness).toBe(1)
    expect(mirror.roughness).toBe(0)
  })
})
