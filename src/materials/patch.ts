import type * as THREE from 'three'

type Shader = Parameters<THREE.Material['onBeforeCompile']>[0]

export interface MaterialPatch {
  /** Unique name. It becomes part of the program cache key. */
  id: string
  uniforms?: Record<string, THREE.IUniform>
  defines?: Record<string, string | number>
  apply(shader: Shader): void
}

interface Patched {
  patches: MaterialPatch[]
}

const store = new WeakMap<THREE.Material, Patched>()

/** Several systems can each add a patch to one material. Patches run in the order they were added. */
export function patchMaterial(material: THREE.Material, patch: MaterialPatch): void {
  let entry = store.get(material)
  if (!entry) {
    const created: Patched = { patches: [] }
    entry = created
    store.set(material, created)
    material.onBeforeCompile = (shader) => {
      for (const p of created.patches) {
        if (p.uniforms) Object.assign(shader.uniforms, p.uniforms)
        p.apply(shader)
      }
    }
    material.customProgramCacheKey = () => created.patches.map((p) => p.id).join('|')
  }
  if (entry.patches.some((p) => p.id === patch.id)) return
  entry.patches.push(patch)
  if (patch.defines) material.defines = { ...(material.defines ?? {}), ...patch.defines }
  material.needsUpdate = true
}

export function patchesOf(material: THREE.Material): string[] {
  return store.get(material)?.patches.map((p) => p.id) ?? []
}

/** Inserts `code` after the first occurrence of `anchor`, and fails loudly when the anchor is gone after a library update. */
export function insertAfter(source: string, anchor: string, code: string): string {
  const at = source.indexOf(anchor)
  if (at < 0) throw new Error(`shader anchor not found: ${anchor}`)
  return source.slice(0, at + anchor.length) + '\n' + code + '\n' + source.slice(at + anchor.length)
}

export function insertBefore(source: string, anchor: string, code: string): string {
  const at = source.indexOf(anchor)
  if (at < 0) throw new Error(`shader anchor not found: ${anchor}`)
  return source.slice(0, at) + code + '\n' + source.slice(at)
}

export function replaceOnce(source: string, anchor: string, code: string): string {
  const at = source.indexOf(anchor)
  if (at < 0) throw new Error(`shader anchor not found: ${anchor}`)
  return source.slice(0, at) + code + source.slice(at + anchor.length)
}
