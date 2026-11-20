import { join } from 'node:path'
import { build } from 'vite'
import { config, defaultPaint } from '../../src/config.ts'
import { args, ensureDir, repoRoot, workDir } from '../lib/env.ts'
import { RenderSession, runTool, specFromArgs, stillName } from '../lib/render.ts'

void runTool(async () => {
  const a = args()
  const detail = a.detail === 'blockout' ? 'blockout' : 'full'
  process.env.SHOWCASE_DETAIL = detail
  const frames = (a.frames ?? '195,360,520,690,800,950').split(',').map(Number)
  const diagnostics = (a.diags ?? 'beauty,clay').split(',')
  const studio = a.studio === 'true'
  const matched = a.match?.split(',').map(Number)
  if (matched && (!studio || matched.length !== 7 || matched.some((n) => !Number.isFinite(n)) || matched[6] <= 0 || matched[6] >= 180)) {
    throw new Error('Use --studio true --match with eye X,Y,Z, target X,Y,Z, vertical FOV.')
  }
  const dir = ensureDir(join(workDir, 'vehicle', studio ? matched ? 'studio-matched' : 'studio' : detail))
  const root = studio ? join(dir, 'dist') : undefined
  if (studio) {
    await build({
      configFile: join(repoRoot, 'vite.config.ts'),
      build: { outDir: root, emptyOutDir: true },
      plugins: [{
        name: 'vehicle-neutral-inspection',
        enforce: 'pre',
        transform(code, id) {
          if (!id.endsWith('/src/core/film-stage.ts')) return
          const key = 'this.scene.add(world.root, vehicle.root, rig.group)'
          const effects = "const weather = detail === 'full' ? await createWeather({ world, vehicle, lights: rig.uniforms }) : null"
          if (!code.includes(key) || !code.includes(effects)) throw new Error('The stage setup changed. Update the studio inspection hook.')
          const camera = 'return this.cameraOverride ?? cameraAt(timeSeconds, this.format, this.vehicle.anchors, this.frameSeconds)'
          const pose = matched ? `
            const state = cameraAt(timeSeconds, this.format, this.vehicle.anchors, this.frameSeconds);
            const eye = new THREE.Vector3(${matched.slice(0, 3).join(',')});
            const target = new THREE.Vector3(${matched.slice(3, 6).join(',')});
            const view = new THREE.PerspectiveCamera();
            view.position.copy(eye);
            view.lookAt(target);
            const aspect = this.format.width / this.format.height;
            return { ...state, position: eye, quaternion: view.quaternion,
              focalMm: state.sensorWidthMm / (2 * aspect * Math.tan(THREE.MathUtils.degToRad(${matched[6]}) / 2)),
              focusDistance: eye.distanceTo(target), fNumber: 16 };
          ` : camera
          return "import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';\n" + code.replace(effects, 'const weather = null').replace(camera, pose).replace(key, `
            this.scene.add(vehicle.root);
            this.scene.background = new THREE.Color(0x303745);
            const inspectionRoom = new RoomEnvironment();
            const env = new THREE.PMREMGenerator(renderer);
            this.scene.environment = env.fromScene(inspectionRoom, 0.035).texture;
            this.scene.environmentIntensity = 0.45;
            this.scene.userData.neutral = this.scene.environment;
            if (${diagnostics.includes('zebra')}) {
              const width = 2048, height = 1024;
              const bands = new Uint8Array(width * height * 4);
              for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                const phase = 2.0 * Math.PI * ((x + 0.5) * 14 / width + (y + 0.5) * 4 / height);
                const v = Math.round(10 + 236 * THREE.MathUtils.smoothstep(Math.cos(phase), 0.19, 0.25));
                bands[i] = bands[i + 1] = bands[i + 2] = v;
                bands[i + 3] = 255;
              }
              const stripes = new THREE.DataTexture(bands, width, height);
              stripes.mapping = THREE.EquirectangularReflectionMapping;
              stripes.minFilter = THREE.LinearFilter;
              stripes.magFilter = THREE.LinearFilter;
              stripes.needsUpdate = true;
              this.scene.userData.stripes = env.fromEquirectangular(stripes).texture;
              stripes.dispose();
            }
            inspectionRoom.dispose();
            env.dispose();
            const bounce = new THREE.HemisphereLight(0xe6ecff, 0x66646c, 0.74);
            const key = new THREE.DirectionalLight(0xfff3df, 1.25);
            key.position.set(4.4, 7.2, 4.3);
            key.castShadow = true;
            key.shadow.bias = -0.0002;
            key.shadow.mapSize.set(1024, 1024);
            const fill = new THREE.DirectionalLight(0xa7c5ff, 0.70);
            fill.position.set(2.2, 4.3, -5.7);
            const deck = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), new THREE.MeshPhysicalMaterial({ color: 0x333a46, roughness: 0.77 }));
            deck.rotation.x = -Math.PI / 2;
            deck.receiveShadow = true;
            this.scene.add(bounce, key, fill, deck);
          `).replace("this.scene.overrideMaterial = view === 'clay'", `
            this.scene.environment = view === 'zebra' ? this.scene.userData.stripes : this.scene.userData.neutral;
            this.scene.overrideMaterial = view === 'zebra' ? new THREE.MeshPhysicalMaterial({ color: 0xececec, metalness: 1, roughness: 0.025 }) : view === 'clay'`)
        },
      }],
    })
  }
  const session = await RenderSession.open(studio ? { build: false, root } : {})
  try {
    for (const diag of diagnostics) for (const frame of frames) {
      const spec = specFromArgs({ ...a, frame: String(frame), diag }, { paint: defaultPaint, format: config.formats.master })
      const file = join(dir, stillName(spec) + '.png')
      const { record, reused } = await session.renderTo(spec, file, { force: studio })
      console.log(`${studio ? 'studio' : detail} ${diag} ${frame}: ${reused ? 'cached' : `${record.seconds} s`} ${record.check.ok ? 'PASS' : 'FAIL'}`)
      if (!record.check.ok) return 2
    }
    return 0
  } finally {
    await session.close()
  }
})
