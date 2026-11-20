export interface ProfileDraw {
  path: string
  system: string
  object: string
  material: string
  program: number
  camera: string
  target: string
  ms: number
}

export interface ProfileOp {
  path: string
  op: string
  target: string
  ms: number
}

export interface ProfileSection {
  path: string
  ms: number
}

export interface ProfileProgram {
  id: number
  name: string
  vertexChars: number
  fragmentChars: number
  compileMs: number
  linkMs: number
  firstUseMs: number
  firstUsePath: string
  vertex?: string
  fragment?: string
}

export interface ProfileDump {
  disjoint: boolean
  draws: ProfileDraw[]
  ops: ProfileOp[]
  sections: ProfileSection[]
  programs: ProfileProgram[]
  timerQuery: boolean
}

/** Runs inside the page. Wraps the stage, the renderer and the GL context so every draw, clear, mipmap build and blit gets a GPU timer query and every section a CPU time. Never part of the app bundle. */
export function installProfiler(): void {
  type Any = any
  const w = window as Any
  if (w.__profile) return
  const stage = w.filmStage as Any
  const renderer = stage.renderer as Any
  const gl = renderer.getContext() as Any
  const now = (): number => performance.now()
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
  const P: Any = { on: false, stack: [] as string[], draws: [], ops: [], sections: [], shaders: new Map(), programs: new Map(), current: null, object: null, target: 'canvas' }
  w.__profile = P
  P.timerQuery = !!ext
  P.pending = [] as Any[]

  const deck = new Set(stage.world.deck.meshes)
  const roots = new Map<Any, string>([[stage.world.root, 'world'], [stage.vehicle.root, 'vehicle'], [stage.rig.group, 'rig']])
  if (stage.weather) {
    const [surface, air] = stage.weather.root.children
    if (surface) roots.set(surface, 'surface water')
    if (air) roots.set(air, 'air')
  }
  const lightCameras = new Map<Any, string>()
  stage.rig.group.traverse((o: Any) => {
    if (o.isLight && o.shadow) lightCameras.set(o.shadow.camera, o.name || o.type)
  })
  const systemOf = (object: Any): string => {
    if (!object) return 'none'
    let child = object
    let o = object
    while (o) {
      if (deck.has(o)) return 'world/deck'
      const root = roots.get(o)
      if (root) return root === 'world' || root === 'vehicle' || root === 'air' || root === 'surface water' ? `${root}/${child === o ? '' : child.name || child.type}` : root
      child = o
      o = o.parent
    }
    return object.isMesh && !object.parent ? 'screen' : `other/${child.name || child.type}`
  }
  const targetName = (t: Any, face = 0): string => (t ? `${t.width}x${t.height}${t.isWebGLCubeRenderTarget ? ` cube${face}` : ''}${t.samples ? ` msaa${t.samples}` : ''}` : 'canvas')

  const wrapSection = (obj: Any, key: string, label: string): void => {
    if (!obj || typeof obj[key] !== 'function') return
    const f = obj[key]
    obj[key] = function (this: Any, ...a: Any[]) {
      if (!P.on) return f.apply(this, a)
      const t = now()
      P.stack.push(label)
      const path = P.stack.join('/')
      try {
        return f.apply(this, a)
      } finally {
        P.stack.pop()
        P.sections.push({ path, ms: now() - t })
      }
    }
  }

  const setTarget = renderer.setRenderTarget
  renderer.setRenderTarget = function (this: Any, t: Any, face = 0, ...rest: Any[]) {
    P.target = targetName(t, face)
    return setTarget.call(this, t, face, ...rest)
  }
  const render = renderer.render
  renderer.render = function (this: Any, scene: Any, camera: Any) {
    if (!P.on) return render.call(this, scene, camera)
    const what = scene === stage.scene ? (scene.overrideMaterial ? 'override' : 'scene') : scene.isMesh ? 'quad' : scene.name || scene.type
    const t = now()
    P.stack.push(`render ${what}`)
    const path = P.stack.join('/')
    try {
      return render.call(this, scene, camera)
    } finally {
      P.stack.pop()
      P.sections.push({ path, ms: now() - t })
    }
  }
  const direct = renderer.renderBufferDirect
  renderer.renderBufferDirect = function (this: Any, camera: Any, scene: Any, geometry: Any, material: Any, object: Any, group: Any) {
    P.object = { object, material, camera }
    try {
      return direct.call(this, camera, scene, geometry, material, object, group)
    } finally {
      P.object = null
    }
  }
  const glWrap = (name: string, kind: 'draw' | 'op'): void => {
    const f = gl[name]
    if (typeof f !== 'function') return
    gl[name] = function (...a: Any[]) {
      if (!P.on) return f.apply(gl, a)
      const q = ext ? gl.createQuery() : null
      if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q)
      const t = now()
      const r = f.apply(gl, a)
      const cpu = now() - t
      if (q) gl.endQuery(ext.TIME_ELAPSED_EXT)
      const ms = cpu
      const path = P.stack.join('/')
      if (kind === 'draw') {
        const o = P.object
        const object = o?.object
        const program = P.programs.get(P.current)
        if (program && program.firstUseMs < 0) {
          program.firstUseMs = ms
          program.firstUsePath = path
        }
        const entry = {
          path,
          system: systemOf(object),
          object: object ? object.name || object.type : 'raw',
          material: o?.material ? o.material.name || o.material.type : 'raw',
          program: program ? program.id : -1,
          camera: o?.camera ? lightCameras.get(o.camera) ?? o.camera.type : 'none',
          target: P.target,
          ms,
        }
        P.draws.push(entry)
        if (q) P.pending.push([q, entry])
      } else {
        const entry = { path, op: name, target: P.target, ms }
        P.ops.push(entry)
        if (q) P.pending.push([q, entry])
      }
      return r
    }
  }
  for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) glWrap(name, 'draw')
  for (const name of ['clear', 'generateMipmap', 'readPixels', 'blitFramebuffer', 'texImage2D', 'texImage3D', 'texSubImage2D', 'texSubImage3D', 'texStorage2D', 'texStorage3D', 'copyTexSubImage2D', 'bufferData', 'invalidateFramebuffer']) glWrap(name, 'op')

  let programId = 0
  const shaderSource = gl.shaderSource
  gl.shaderSource = function (shader: Any, source: string) {
    P.shaders.set(shader, { chars: source.length, ms: 0, source })
    return shaderSource.call(gl, shader, source)
  }
  const compileShader = gl.compileShader
  gl.compileShader = function (shader: Any) {
    const t = now()
    compileShader.call(gl, shader)
    const s = P.shaders.get(shader)
    if (s) s.ms = now() - t
  }
  const attached = new Map<Any, Any[]>()
  const attachShader = gl.attachShader
  gl.attachShader = function (program: Any, shader: Any) {
    attached.set(program, [...(attached.get(program) ?? []), shader])
    return attachShader.call(gl, program, shader)
  }
  const linkProgram = gl.linkProgram
  gl.linkProgram = function (program: Any) {
    const t = now()
    linkProgram.call(gl, program)
    gl.getProgramParameter(program, gl.LINK_STATUS)
    const linkMs = now() - t
    const shaders = (attached.get(program) ?? []).map((s: Any) => ({ ...P.shaders.get(s), kind: gl.getShaderParameter(s, gl.SHADER_TYPE) }))
    const vertex = shaders.find((s: Any) => s.kind === gl.VERTEX_SHADER)
    const fragment = shaders.find((s: Any) => s.kind === gl.FRAGMENT_SHADER)
    P.programs.set(program, {
      id: programId++,
      name: '',
      vertexChars: vertex?.chars ?? 0,
      fragmentChars: fragment?.chars ?? 0,
      compileMs: (vertex?.ms ?? 0) + (fragment?.ms ?? 0),
      linkMs,
      firstUseMs: -1,
      firstUsePath: '',
      path: P.stack.join('/'),
      vertex: vertex?.source,
      fragment: fragment?.source,
    })
  }
  const useProgram = gl.useProgram
  gl.useProgram = function (program: Any) {
    P.current = program
    return useProgram.call(gl, program)
  }

  wrapSection(stage, 'beginFrame', 'frame')
  wrapSection(stage, 'renderSample', 'sample')
  const partNames = ['shade', 'reflect', 'haze']
  stage.parts.forEach((part: Any, i: number) => {
    wrapSection(part, 'beginFrame', partNames[i] ?? `part${i}`)
    wrapSection(part, 'beforeSample', partNames[i] ?? `part${i}`)
  })
  wrapSection(stage.world, 'beginFrame', 'world')
  wrapSection(stage.world, 'beginSample', 'world')
  if (stage.weather) {
    wrapSection(stage.weather, 'beginFrame', 'weather')
    wrapSection(stage.weather, 'beginSample', 'weather')
  }
  for (const pass of stage.passes) wrapSection(pass, 'render', `pass ${pass.id}`)
  wrapSection(stage.bokeh, 'render', 'pass bokeh')
  wrapSection(stage.copy, 'render', 'copy')
  wrapSection(renderer.shadowMap, 'render', 'shadow maps')
  const engine = w.__engine
  if (engine) {
    wrapSection(engine.accumulator, 'addSample', 'accumulate')
    wrapSection(engine.accumulator, 'settle', 'settle')
    wrapSection(engine.resolver, 'resolve', 'post')
  }

  P.settle = async (): Promise<void> => {
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    gl.flush()
    while (gl.getSyncParameter(sync, gl.SYNC_STATUS) !== gl.SIGNALED) await new Promise((r) => setTimeout(r, 5))
    gl.deleteSync(sync)
  }

  P.collect = async (): Promise<boolean> => {
    if (!ext) return false
    const last = P.pending.at(-1)
    while (last && !gl.getQueryParameter(last[0], gl.QUERY_RESULT_AVAILABLE)) await new Promise((r) => setTimeout(r, 20))
    const disjoint = !!gl.getParameter(ext.GPU_DISJOINT_EXT)
    for (const [q, entry] of P.pending) {
      entry.cpuMs = entry.ms
      entry.ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6
      gl.deleteQuery(q)
    }
    P.pending = []
    return disjoint
  }

  P.dump = async (sources = false): Promise<ProfileDump> => {
    const disjoint = await P.collect()
    for (const p of renderer.info.programs ?? []) {
      const entry = P.programs.get(p.program)
      if (entry) entry.name = p.name || p.type || String(p.id)
    }
    const programs = [...P.programs.values()].map((p: Any) => (sources ? { ...p } : { ...p, vertex: undefined, fragment: undefined }))
    const out = { disjoint, draws: P.draws, ops: P.ops, sections: P.sections, programs, timerQuery: P.timerQuery }
    P.draws = []
    P.ops = []
    P.sections = []
    return out
  }
}

export interface CompileTime {
  id: number
  name: string
  linkMs: number
  drawMs: number
  againLinkMs: number
  againDrawMs: number
  ok: boolean
}

/** Runs inside a blank page. Compiles, links and draws each program once into a small canvas and syncs with a readback, twice, to separate the first compile from a cached one. */
export function benchPrograms(programs: { id: number; name: string; vertex: string; fragment: string }[]): CompileTime[] {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 4
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true })!
  const pixel = new Uint8Array(4)
  const once = (p: { vertex: string; fragment: string }): [number, number, boolean] => {
    const t0 = performance.now()
    const vs = gl.createShader(gl.VERTEX_SHADER)!
    gl.shaderSource(vs, p.vertex)
    gl.compileShader(vs)
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!
    gl.shaderSource(fs, p.fragment)
    gl.compileShader(fs)
    const program = gl.createProgram()!
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    const ok = !!gl.getProgramParameter(program, gl.LINK_STATUS)
    const t1 = performance.now()
    if (ok) {
      gl.useProgram(program)
      gl.viewport(0, 0, 4, 4)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    const t2 = performance.now()
    gl.deleteProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    return [t1 - t0, t2 - t1, ok]
  }
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
  const first = programs.map((p) => once(p))
  const again = programs.map((p) => once(p))
  return programs.map((p, i) => ({ id: p.id, name: p.name, linkMs: first[i][0], drawMs: first[i][1], againLinkMs: again[i][0], againDrawMs: again[i][1], ok: first[i][2] }))
}

/** Runs inside the page. Lists what decides which savings are exact: shadow casters on the deck, transmissive meshes and their screen bounds. */
export function sceneFacts(): Record<string, unknown> {
  type Any = any
  const stage = (window as Any).filmStage as Any
  const deck = stage.world.deck.meshes.map((m: Any) => ({ name: m.name, castShadow: m.castShadow, receiveShadow: m.receiveShadow, visible: m.visible }))
  const transmissive: Any[] = []
  let meshes = 0
  let casters = 0
  stage.scene.traverse((o: Any) => {
    if (!o.isMesh) return
    meshes++
    if (o.castShadow) casters++
    const materials = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of materials) if (m.transmission > 0) transmissive.push({ name: o.name, parent: o.parent?.name, material: m.name || m.type, transmission: m.transmission, roughness: m.roughness, thickness: m.thickness, side: m.side, visible: o.visible })
  })
  const lights: Any[] = []
  stage.rig.group.traverse((o: Any) => {
    if (o.isLight) lights.push({ name: o.name, type: o.type, castShadow: o.castShadow, visible: o.visible, distance: o.distance })
  })
  return { meshes, casters, deck, transmissive, lights }
}
