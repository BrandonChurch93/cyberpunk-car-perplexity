import * as THREE from 'three'

const width = 2048
const height = 1024
const bands = 18

/** Bands of equal angle around the vertical axis and in elevation would hide breaks along one of them, so the stripes run diagonally. */
export function stripeEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const data = new Float32Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const theta = ((y + 0.5) / height) * Math.PI
    for (let x = 0; x < width; x++) {
      const phi = ((x + 0.5) / width) * Math.PI * 2
      const s = (theta + phi * 0.25) * (bands / Math.PI)
      const f = s - Math.floor(s)
      const edge = 0.5 * bands * (Math.PI / height) * 1.5
      const on = THREE.MathUtils.smoothstep(f, 0.25 - edge, 0.25 + edge) - THREE.MathUtils.smoothstep(f, 0.75 - edge, 0.75 + edge)
      const value = 0.03 + 0.97 * on
      const i = (y * width + x) * 4
      data[i] = value
      data[i + 1] = value
      data[i + 2] = value
      data[i + 3] = 1
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType)
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.colorSpace = THREE.NoColorSpace
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  const pmrem = new THREE.PMREMGenerator(renderer)
  const target = pmrem.fromEquirectangular(texture)
  pmrem.dispose()
  texture.dispose()
  return target.texture
}

export function zebraMirror(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0 })
}
