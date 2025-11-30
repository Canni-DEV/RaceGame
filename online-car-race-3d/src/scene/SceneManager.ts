import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass'
import { LUTPass } from 'three/examples/jsm/postprocessing/LUTPass'
import { CameraRig } from '../render/CameraRig'
import { SocketClient } from '../net/SocketClient'
import { GameStateStore } from '../state/GameStateStore'
import { TrackScene } from './TrackScene'
import { ViewerControllerAccess } from './ViewerControllerAccess'
import { PlayerListOverlay } from './PlayerListOverlay'
import { HotkeyOverlay } from './HotkeyOverlay'
import { AudioManager } from '../audio/AudioManager'
import { RaceHud } from './RaceHud'

export class SceneManager {
  private readonly container: HTMLElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly cameraRig: CameraRig
  private readonly clock: THREE.Clock
  private readonly trackScene: TrackScene
  private readonly socketClient: SocketClient
  private readonly gameStateStore: GameStateStore
  private readonly controllerAccess: ViewerControllerAccess
  private readonly playerListOverlay: PlayerListOverlay
  private readonly raceHud: RaceHud
  private readonly audioManager: AudioManager
  private readonly sunPosition = new THREE.Vector3()
  private composer: EffectComposer | null = null
  private bloomPass: UnrealBloomPass | null = null
  private cloudMaterial: THREE.ShaderMaterial | null = null
  private keyLight: THREE.DirectionalLight | null = null
  private isOrbitDragging = false
  private orbitPointerId: number | null = null
  private lastPointerPosition: { x: number; y: number } | null = null
  private readonly orbitRotateSpeed = 0.005
  private readonly orbitTiltSpeed = 0.0035
  private readonly zoomStep = 0.08

  constructor(container: HTMLElement) {
    this.container = container
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.setClearColor(0x05070f)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.35
    this.renderer.physicallyCorrectLights = true
    this.renderer.domElement.classList.add('canvas-container')
    this.container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.FogExp2(new THREE.Color('#0b1024'), 0.00135)
    this.setupEnvironment()

    const aspect = container.clientWidth / container.clientHeight
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000)

    // Mantener el listener de audio acoplado a la cámara y dentro de la escena
    this.scene.add(this.camera)

    this.cameraRig = new CameraRig(this.camera)
    this.audioManager = new AudioManager(this.camera)

    this.setupLights()

    this.composer = this.setupPostProcessing()

    this.clock = new THREE.Clock()
    this.gameStateStore = new GameStateStore()
    this.trackScene = new TrackScene(
      this.scene,
      this.camera,
      this.cameraRig,
      this.gameStateStore,
      this.keyLight,
      this.audioManager,
    )
    this.controllerAccess = new ViewerControllerAccess(
      this.container,
      this.gameStateStore,
    )
    this.playerListOverlay = new PlayerListOverlay(
      this.container,
      this.gameStateStore,
      { onSelectPlayer: this.handleSelectPlayer },
    )
    this.raceHud = new RaceHud(this.container, this.gameStateStore)
    new HotkeyOverlay(this.container)

    this.socketClient = new SocketClient()
    this.socketClient.onRoomInfo((info) => {
      this.gameStateStore.setRoomInfo(info.roomId, info.playerId, info.track, info.players)
    })
    this.socketClient.onState((state) => {
      this.gameStateStore.updateState(state)
    })
    this.socketClient.onError((message) => {
      console.error(`[SceneManager] ${message}`)
    })
    this.socketClient.connect()

    window.addEventListener('resize', this.handleResize)
    window.addEventListener('keydown', this.handleGlobalKeyDown)
    this.renderer.domElement.addEventListener('contextmenu', this.preventContextMenu)
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown)
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove)
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp)
    this.renderer.domElement.addEventListener('pointerleave', this.handlePointerUp)
    this.renderer.domElement.addEventListener('pointercancel', this.handlePointerUp)
    this.renderer.domElement.addEventListener('wheel', this.handleWheel, { passive: false })
    this.animate()
  }

  private setupLights(): void {
    const hemisphere = new THREE.HemisphereLight(0x3c5d88, 0x1a0f2b, 0.55)
    hemisphere.intensity = 0.85
    this.scene.add(hemisphere)

    const keyLight = new THREE.DirectionalLight(0xffc68a, 1.25)
    keyLight.position.set(120, 65, 30)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.width = 4096
    keyLight.shadow.mapSize.height = 4096
    keyLight.shadow.bias = -0.00028
    keyLight.shadow.normalBias = 0.012
    keyLight.shadow.camera.near = 1
    keyLight.shadow.camera.far = 600
    keyLight.shadow.camera.left = -150
    keyLight.shadow.camera.right = 150
    keyLight.shadow.camera.top = 150
    keyLight.shadow.camera.bottom = -150
    this.scene.add(keyLight)
    this.scene.add(keyLight.target)

    const fillLight = new THREE.DirectionalLight(0x7bc6ff, 0.42)
    fillLight.position.set(-110, 55, 60)
    fillLight.castShadow = false
    this.scene.add(fillLight)
    this.scene.add(fillLight.target)

    const rimLight = new THREE.DirectionalLight(0x8ee1ff, 0.6)
    rimLight.position.set(80, 40, -140)
    rimLight.castShadow = false
    this.scene.add(rimLight)
    this.scene.add(rimLight.target)

    this.keyLight = keyLight
  }

  private setupEnvironment(): void {
    const sky = new Sky()
    sky.scale.setScalar(480)

    const uniforms = sky.material.uniforms
    uniforms['turbidity'].value = 11
    uniforms['rayleigh'].value = 1.15
    uniforms['mieCoefficient'].value = 0.0095
    uniforms['mieDirectionalG'].value = 0.87

    const phi = THREE.MathUtils.degToRad(70)
    const theta = THREE.MathUtils.degToRad(225)
    this.sunPosition.setFromSphericalCoords(1, phi, theta)
    uniforms['sunPosition'].value.copy(this.sunPosition)

    this.scene.add(sky)

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer)
    const envMap = pmremGenerator.fromScene(sky).texture
    this.scene.environment = envMap
    pmremGenerator.dispose()

    this.scene.background = new THREE.Color('#060b18')

    const cloudLayer = this.createCloudLayer()
    if (cloudLayer) {
      this.scene.add(cloudLayer)
    }
  }

  private setupPostProcessing(): EffectComposer {
    const composer = new EffectComposer(this.renderer)
    composer.setSize(this.container.clientWidth, this.container.clientHeight)

    const renderPass = new RenderPass(this.scene, this.camera)
    composer.addPass(renderPass)

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.container.clientWidth, this.container.clientHeight),
      0.85,
      0.6,
      0.02,
    )
    bloomPass.threshold = 0.18
    bloomPass.strength = 0.65
    bloomPass.radius = 0.45
    composer.addPass(bloomPass)

    const lutTexture = this.createFilmLutTexture()
    const lutPass = new LUTPass({ lut: lutTexture, intensity: 0.85 })
    composer.addPass(lutPass)

    this.bloomPass = bloomPass

    return composer
  }

  private createFilmLutTexture(): THREE.Data3DTexture {
    const size = 16
    const data = new Uint8Array(size * size * size * 4)

    let pointer = 0
    for (let b = 0; b < size; b++) {
      for (let g = 0; g < size; g++) {
        for (let r = 0; r < size; r++) {
          const red = r / (size - 1)
          const green = g / (size - 1)
          const blue = b / (size - 1)

          const luma = red * 0.299 + green * 0.587 + blue * 0.114
          const warmHighlights = 0.08 * luma
          const coolShadows = 0.06 * (1 - luma)

          const gradedR = THREE.MathUtils.clamp(red + warmHighlights, 0, 1)
          const gradedG = THREE.MathUtils.clamp(green + warmHighlights * 0.6, 0, 1)
          const gradedB = THREE.MathUtils.clamp(blue + coolShadows - warmHighlights * 0.2, 0, 1)

          data[pointer++] = Math.round(gradedR * 255)
          data[pointer++] = Math.round(gradedG * 255)
          data[pointer++] = Math.round(gradedB * 255)
          data[pointer++] = 255
        }
      }
    }

    const texture = new THREE.Data3DTexture(data, size, size, size)
    texture.format = THREE.RGBAFormat
    texture.type = THREE.UnsignedByteType
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.unpackAlignment = 1
    texture.needsUpdate = true
    return texture
  }

  private createCloudLayer(): THREE.Mesh | null {
    const geometry = new THREE.SphereGeometry(420, 64, 32)
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uTint: { value: new THREE.Color('#7dc7ff') },
        uFog: { value: new THREE.Color('#060b18') },
        uIntensity: { value: 0.55 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPosition;

        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorldPosition;
        uniform float uTime;
        uniform vec3 uTint;
        uniform vec3 uFog;
        uniform float uIntensity;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        float fbm(vec2 p) {
          float value = 0.0;
          float amplitude = 0.5;
          for (int i = 0; i < 5; i++) {
            value += amplitude * noise(p);
            p = p * 2.03 + vec2(7.1, 5.3);
            amplitude *= 0.55;
          }
          return value;
        }

        void main() {
          vec3 dir = normalize(vWorldPosition);
          float altitude = smoothstep(-0.2, 0.6, dir.y);

          vec2 uv = dir.xz * 3.4 + uTime * 0.03;
          float clouds = fbm(uv);
          float mask = smoothstep(0.55, 0.78, clouds) * altitude;

          vec3 color = mix(uFog, uTint, mask);
          gl_FragColor = vec4(color, mask * uIntensity);
        }
      `,
    })

    this.cloudMaterial = material
    const mesh = new THREE.Mesh(geometry, material)
    mesh.renderOrder = -1
    return mesh
  }

  private readonly handleResize = (): void => {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
    if (this.composer) {
      this.composer.setSize(width, height)
    }
    if (this.bloomPass) {
      this.bloomPass.setSize(width, height)
    }
  }

  private readonly animate = (): void => {
    requestAnimationFrame(this.animate)
    const delta = this.clock.getDelta()
    this.trackScene.update(delta)
    this.cameraRig.update(delta)
    if (this.cloudMaterial) {
      const uniform = this.cloudMaterial.uniforms.uTime
      if (uniform && typeof uniform.value === 'number') {
        uniform.value += delta
      }
    }
    if (this.composer) {
      this.composer.render()
    } else {
      this.renderer.render(this.scene, this.camera)
    }
  }

  private readonly preventContextMenu = (event: Event): void => {
    event.preventDefault()
  }

  private readonly handleGlobalKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      return
    }

    const key = event.key?.toLowerCase()
    const code = event.code?.toLowerCase()
    const matchesKey = (expected: string): boolean => {
      return key === expected || code === `key${expected}`
    }

    if (matchesKey('s')) {
      this.audioManager.toggle()
      event.preventDefault()
      event.stopPropagation()
    } else if (matchesKey('q')) {
      this.controllerAccess.toggleVisibility()
      event.preventDefault()
      event.stopPropagation()
    } else if (matchesKey('p')) {
      this.playerListOverlay.toggleVisibility()
      event.preventDefault()
      event.stopPropagation()
    } else if (matchesKey('c')) {
      this.raceHud.toggleVisibility()
      event.preventDefault()
      event.stopPropagation()
    } else if (matchesKey('r')) {
      this.cameraRig.toggleAutoOrbit()
      event.preventDefault()
      event.stopPropagation()
    }
  }

  private readonly handleSelectPlayer = (playerId: string): void => {
    this.trackScene.setFollowTarget(playerId)
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 2 || this.cameraRig.isFollowing()) {
      return
    }
    this.isOrbitDragging = true
    this.orbitPointerId = event.pointerId
    this.lastPointerPosition = { x: event.clientX, y: event.clientY }
    this.renderer.domElement.setPointerCapture(event.pointerId)
    this.cameraRig.beginManualOrbit()
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.isOrbitDragging || this.orbitPointerId !== event.pointerId || !this.lastPointerPosition) {
      return
    }
    const deltaX = event.clientX - this.lastPointerPosition.x
    const deltaY = event.clientY - this.lastPointerPosition.y
    this.lastPointerPosition = { x: event.clientX, y: event.clientY }

    const deltaAzimuth = -deltaX * this.orbitRotateSpeed
    const deltaAngle = -deltaY * this.orbitTiltSpeed
    this.cameraRig.adjustOrbit(deltaAzimuth, deltaAngle)
  }

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (this.orbitPointerId !== event.pointerId) {
      return
    }
    this.renderer.domElement.releasePointerCapture(event.pointerId)
    this.isOrbitDragging = false
    this.orbitPointerId = null
    this.lastPointerPosition = null
    this.cameraRig.endManualOrbit()
  }

  private readonly handleWheel = (event: WheelEvent): void => {
    if (this.cameraRig.isFollowing()) {
      return
    }
    event.preventDefault()
    const factor = 1 + Math.sign(event.deltaY) * this.zoomStep
    this.cameraRig.adjustZoom(factor)
  }
}
