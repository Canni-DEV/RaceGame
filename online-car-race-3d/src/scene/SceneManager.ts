import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
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
  private readonly bloomResolution = new THREE.Vector2(1, 1)
  private keyLight: THREE.DirectionalLight | null = null
  private isOrbitDragging = false
  private orbitPointerId: number | null = null
  private readonly lastPointerPosition = new THREE.Vector2()
  private hasLastPointerPosition = false
  private readonly orbitRotateSpeed = 0.005
  private readonly orbitTiltSpeed = 0.0035
  private readonly zoomStep = 0.08
  private readonly maxPixelRatio = 1
  private composer: EffectComposer | null = null
  private bloomPass: UnrealBloomPass | null = null
  private starField: THREE.Points | null = null

  constructor(container: HTMLElement) {
    this.container = container
    const devicePixelRatio = window.devicePixelRatio || 1
    this.renderer = new THREE.WebGLRenderer({ antialias: devicePixelRatio > 1 })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.maxPixelRatio))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.shadowMap.enabled = false
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.physicallyCorrectLights = true
    this.renderer.domElement.classList.add('canvas-container')
    this.container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.setupEnvironment()

    const aspect = container.clientWidth / container.clientHeight
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000)

    // Mantener el listener de audio acoplado a la cámara y dentro de la escena
    this.scene.add(this.camera)

    this.cameraRig = new CameraRig(this.camera)
    this.audioManager = new AudioManager(this.camera)

    this.setupLights()
    this.setupPostprocessing()

    this.clock = new THREE.Clock()
    this.gameStateStore = new GameStateStore()
    this.trackScene = new TrackScene(
      this.scene,
      this.camera,
      this.cameraRig,
      this.gameStateStore,
      this.keyLight,
      this.audioManager,
      this.handlePlayerAutoFollow,
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
    this.socketClient.onStateDelta((delta) => {
      const applied = this.gameStateStore.applyDelta(delta)
      if (!applied) {
        this.socketClient.requestStateFull(this.gameStateStore.getRoomId() ?? undefined)
      }
    })
    this.socketClient.onPlayerUpdate((player) => {
      this.gameStateStore.updatePlayer({
        playerId: player.playerId,
        username: player.username,
        isNpc: false,
      })
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
    const hemisphere = new THREE.HemisphereLight(0x400080, 0x000000, 0.5)
    this.scene.add(hemisphere)
    this.keyLight = null
  }

  private setupEnvironment(): void {
    this.scene.background = new THREE.Color(0x050510)
    this.scene.fog = null

    const width = 1024
    const height = 512
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    const gradient = context.createLinearGradient(0, 0, 0, height)
    gradient.addColorStop(0, '#0e1842')
    gradient.addColorStop(0.55, '#080a1d')
    gradient.addColorStop(1, '#04040b')
    context.fillStyle = gradient
    context.fillRect(0, 0, width, height)

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.mapping = THREE.EquirectangularReflectionMapping

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer)
    const envMap = pmremGenerator.fromEquirectangular(texture).texture
    pmremGenerator.dispose()

    this.scene.environment = envMap

    const stars = this.createStarField()
    if (stars) {
      this.scene.add(stars)
      this.starField = stars
    }
  }

  private createStarField(): THREE.Points | null {
    const starCount = 1200
    const radius = 900
    const positions = new Float32Array(starCount * 3)
    const colors = new Float32Array(starCount * 3)

    for (let i = 0; i < starCount; i++) {
      const direction = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
      ).normalize()
      const distance = radius * (0.55 + Math.random() * 0.45)
      const tint = Math.random() > 0.6 ? new THREE.Color(0x88d7ff) : new THREE.Color(0xff66ff)
      const variation = THREE.MathUtils.randFloat(0.75, 1.1)
      tint.multiplyScalar(variation)

      const idx = i * 3
      positions[idx] = direction.x * distance
      positions[idx + 1] = direction.y * distance
      positions[idx + 2] = direction.z * distance
      colors[idx] = tint.r
      colors[idx + 1] = tint.g
      colors[idx + 2] = tint.b
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.computeBoundingSphere()

    const material = new THREE.PointsMaterial({
      size: 1.1,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

    const points = new THREE.Points(geometry, material)
    points.name = 'star-field'
    points.frustumCulled = false
    return points
  }

  private setupPostprocessing(): void {
    this.bloomResolution.set(this.container.clientWidth, this.container.clientHeight)

    const renderPass = new RenderPass(this.scene, this.camera)
    const bloomPass = new UnrealBloomPass(this.bloomResolution.clone(), 1.8, 0.5, 0.12)
    bloomPass.threshold = 0.12
    bloomPass.strength = 2
    bloomPass.radius = 0.5

    const composer = new EffectComposer(this.renderer)
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxPixelRatio))
    composer.setSize(this.container.clientWidth, this.container.clientHeight)
    composer.addPass(renderPass)
    composer.addPass(bloomPass)

    this.composer = composer
    this.bloomPass = bloomPass
  }

  private readonly handleResize = (): void => {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
    this.composer?.setSize(width, height)
    this.bloomResolution.set(width, height)
    this.bloomPass?.setSize(width, height)
  }

  private readonly animate = (): void => {
    requestAnimationFrame(this.animate)
    const delta = this.clock.getDelta()
    this.trackScene.update(delta)
    this.cameraRig.update(delta)
    if (this.starField) {
      this.starField.position.copy(this.camera.position)
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

  private readonly handlePlayerAutoFollow = (): void => {
    this.controllerAccess.hide()
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
    this.lastPointerPosition.set(event.clientX, event.clientY)
    this.hasLastPointerPosition = true
    this.renderer.domElement.setPointerCapture(event.pointerId)
    this.cameraRig.beginManualOrbit()
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.isOrbitDragging || this.orbitPointerId !== event.pointerId || !this.hasLastPointerPosition) {
      return
    }
    const deltaX = event.clientX - this.lastPointerPosition.x
    const deltaY = event.clientY - this.lastPointerPosition.y
    this.lastPointerPosition.set(event.clientX, event.clientY)

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
    this.hasLastPointerPosition = false
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
