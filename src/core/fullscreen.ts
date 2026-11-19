import * as THREE from 'three'

const geometry = new THREE.BufferGeometry()
geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2))
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

export const fullscreenVertex = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export class FullscreenPass {
  readonly material: THREE.RawShaderMaterial | THREE.ShaderMaterial
  private readonly mesh: THREE.Mesh

  constructor(material: THREE.RawShaderMaterial | THREE.ShaderMaterial) {
    this.material = material
    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.frustumCulled = false
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null): void {
    renderer.setRenderTarget(target)
    renderer.render(this.mesh, camera)
  }
}

export function passMaterial(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, extra: THREE.ShaderMaterialParameters = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: fullscreenVertex,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    ...extra,
  })
}
