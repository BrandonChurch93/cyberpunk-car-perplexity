import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { config, frameCount } from '../src/config'
import { codecFor, codecStrings, formatKeyOf, SegmentFile } from '../src/capture/export'
import { beatMarks, beatOfFrame, clock, interactiveSize, playbackFrame, remainingSeconds, withParams } from '../src/director/ui/logic'
import { exitDistance, Orbit } from '../src/director/ui/orbit'

describe('modes: timeline helpers', () => {
  it('marks every beat at its start frame and spans the whole bar', () => {
    const marks = beatMarks()
    expect(marks.map((m) => m.id)).toEqual(config.beats.map((b) => b.id))
    expect(marks[0].left).toBe(0)
    expect(marks.reduce((s, m) => s + m.width, 0)).toBeCloseTo(100, 9)
    for (const m of marks) expect(beatOfFrame(m.startFrame)).toBe(m.id)
  })

  it('picks playback frames from elapsed time and loops without skipping the last frame', () => {
    expect(playbackFrame(0, 0)).toBe(0)
    expect(playbackFrame(0, 1000)).toBe(config.film.fps)
    expect(playbackFrame(frameCount - 1, 0)).toBe(frameCount - 1)
    expect(playbackFrame(frameCount - 1, 1000 / config.film.fps + 1e-6)).toBe(0)
    expect(playbackFrame(10, config.film.durationSeconds * 1000)).toBe(10)
    expect(playbackFrame(0, -50)).toBe(0)
  })

  it('formats clocks and estimates time remaining', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(65)).toBe('1:05')
    expect(clock(3725)).toBe('1:02:05')
    expect(remainingSeconds(0, 10, 5)).toBeNull()
    expect(remainingSeconds(5, 10, 50)).toBe(50)
  })

  it('rewrites URL parameters and removes the ones set to null', () => {
    const url = withParams('http://host/sub/index.html?mode=live&tier=draft&frame=3', { mode: 'export', tier: null, paint: 'x' })
    const p = new URL(url).searchParams
    expect(new URL(url).pathname).toBe('/sub/index.html')
    expect(p.get('mode')).toBe('export')
    expect(p.has('tier')).toBe(false)
    expect(p.get('frame')).toBe('3')
    expect(p.get('paint')).toBe('x')
  })

  it('keeps the interactive render inside its pixel budget and the aspect ratio', () => {
    const { width, height } = config.formats.master
    const s = interactiveSize(width, height, 200_000)
    expect(s.width * s.height).toBeLessThanOrEqual(200_000 * 1.01)
    expect(s.width / s.height).toBeCloseTo(width / height, 2)
    expect(interactiveSize(100, 50, 1e9)).toEqual({ width: 100, height: 50 })
  })
})

describe('modes: orbit', () => {
  const box = new THREE.Box3(new THREE.Vector3(-1, 0, -2.3), new THREE.Vector3(1, 1.2, 2.3))

  it('measures the distance to the box surface', () => {
    expect(exitDistance(box, new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(1, 0, 0))).toBeCloseTo(1, 9)
    expect(exitDistance(box, new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(0, 0, -1))).toBeCloseTo(2.3, 9)
  })

  it('never puts the camera inside the vehicle or below the deck', () => {
    const orbit = new Orbit(box)
    const margin = orbit.limits.margin
    for (let i = 0; i < 400; i++) {
      orbit.rotate(0.37, (i % 7) * 0.21 - 0.6)
      orbit.zoom(i % 3 === 0 ? 0.2 : 1.7)
      const p = orbit.position()
      expect(p.y).toBeGreaterThanOrEqual(orbit.limits.minHeight - 1e-9)
      expect(box.clone().expandByScalar(margin * 0.99).containsPoint(p)).toBe(false)
      expect(orbit.distance).toBeLessThanOrEqual(orbit.limits.maxDistance + 1e-9)
    }
  })

  it('builds a camera that looks at the target', () => {
    const orbit = new Orbit(box)
    const state = orbit.cameraState(config.formats.master)
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(state.quaternion)
    const toTarget = orbit.target.clone().sub(state.position).normalize()
    expect(forward.dot(toTarget)).toBeCloseTo(1, 6)
    expect(config.lens.focalLengthsMm).toContain(state.focalMm)
  })
})

describe('modes: export helpers', () => {
  it('assembles positioned writes, with later writes replacing earlier bytes', async () => {
    const file = new SegmentFile()
    file.write(0, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
    file.write(8, new Uint8Array([9, 10]))
    file.write(2, new Uint8Array([30, 40]))
    file.write(7, new Uint8Array([80, 90]))
    expect(file.size).toBe(10)
    const bytes = new Uint8Array(await file.toBlob('video/mp4').arrayBuffer())
    expect([...bytes]).toEqual([1, 2, 30, 40, 5, 6, 7, 80, 90, 10])
  })

  it('refuses to save a file with holes', () => {
    const file = new SegmentFile()
    file.write(0, new Uint8Array([1]))
    file.write(5, new Uint8Array([2]))
    expect(() => file.toBlob('video/mp4')).toThrow()
  })

  it('knows the configured codec and picks a level that fits every format', () => {
    const codec = codecFor(config.export.videoCodec)
    for (const f of Object.values(config.formats)) {
      const strings = codecStrings(codec, f.width, f.height, config.film.fps)
      expect(strings.length).toBeGreaterThan(0)
    }
    expect(codecStrings('avc', 1920, 1080, 30)[0]).toBe('avc1.640028')
    expect(() => codecFor('nonsense')).toThrow()
  })

  it('maps each format to its file name', () => {
    for (const [key, f] of Object.entries(config.formats)) expect(formatKeyOf(f)).toBe(key)
    expect(Object.keys(config.export.files).sort()).toEqual(Object.keys(config.formats).sort())
  })
})
