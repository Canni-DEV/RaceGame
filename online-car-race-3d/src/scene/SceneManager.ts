import * as THREE from 'three'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { isProceduralSkyEnabled, resolvePublicAssetUrl } from '../config'
import { CameraRig } from '../render/CameraRig'
import { SocketClient } from '../net/SocketClient'
import { GameStateStore } from '../state/GameStateStore'
import { TrackScene } from './TrackScene'
import { ViewerControllerAccess } from './ViewerControllerAccess'
import { PlayerListOverlay } from './PlayerListOverlay'
import { HotkeyOverlay } from './HotkeyOverlay'
import { AudioManager } from '../audio/AudioManager'
import { GameAudioSystem } from '../audio/GameAudioSystem'
import { RaceHud } from './RaceHud'
import { ProceduralSky } from '../render/ProceduralSky'
import { LoadingScreen } from './LoadingScreen'
import { RadioSystem } from './RadioSystem'

const DEFAULT_HDR_SKYBOX = 'textures/empty_play_room_4k.hdr'
const SKYBOX_BACKGROUND_CONFIG = {
  radius: 900,
  offsetY: -20,
}

const getEnvFlag = (key: string, defaultValue: boolean): boolean => {
  const raw = import.meta.env?.[key]
  if (typeof raw !== 'string') {
    return defaultValue
  }
  return raw.toLowerCase() === 'true' || raw === '1'
}

const getSkyboxUrl = (): string => {
  const candidate = import.meta.env?.VITE_SKYBOX_HDR_URL
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return resolvePublicAssetUrl(candidate.trim())
  }
  return resolvePublicAssetUrl(DEFAULT_HDR_SKYBOX)
}

const HDR_BACKGROUND_ENABLED = getEnvFlag('VITE_ENABLE_HDR_BACKGROUND', false)

export class SceneManager {
  private readonly container: HTMLElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly cameraRig: CameraRig
  private readonly clock: THREE.Clock
  private readonly trackScene: TrackScene
  private sky: ProceduralSky | null = null
  private readonly socketClient: SocketClient
  private readonly gameStateStore: GameStateStore
  private readonly controllerAccess: ViewerControllerAccess
  private readonly playerListOverlay: PlayerListOverlay
  private readonly raceHud: RaceHud
  private readonly audioManager: AudioManager
  private readonly loadingScreen: LoadingScreen
  private readonly radioSystem: RadioSystem
  private keyLight: THREE.DirectionalLight | null = null
  private fillLight: THREE.DirectionalLight | null = null
  private rimLight: THREE.DirectionalLight | null = null
  private isOrbitDragging = false
  private orbitPointerId: number | null = null
  private readonly lastPointerPosition = new THREE.Vector2()
  private radioPointerId: number | null = null
  private readonly radioPointerStart = new THREE.Vector2()
  private radioPointerMoved = false
  private readonly radioClickTolerance = 6
  private readonly orbitRotateSpeed = 0.005
  private readonly orbitTiltSpeed = 0.0035
  private readonly zoomStep = 0.08
  private readonly pointerEndEvents: Array<'pointerup' | 'pointerleave' | 'pointercancel'> = [
    'pointerup',
    'pointerleave',
    'pointercancel',
  ]
  private readonly minShadowMapSize = 512
  private readonly maxShadowMapSize = 1024
  private readonly maxPixelRatio = 1
  private lastShadowMapSize: number | null = null
  private environmentMap: THREE.Texture | null = null
  private hdrBackground: THREE.Mesh | null = null
  private readonly hdrLoader = new HDRLoader()
  private readonly skyboxPath = getSkyboxUrl()

  constructor(container: HTMLElement) {
    this.container = container
    this.renderer = this.createRenderer(container)

    this.loadingScreen = new LoadingScreen(this.container)
    this.loadingScreen.bindLoadingManager()

    this.scene = new THREE.Scene()
    this.setupEnvironment()

    this.camera = this.createCamera(container)

    // Mantener el listener de audio acoplado a la cámara y dentro de la escena
    this.scene.add(this.camera)

    this.cameraRig = new CameraRig(this.camera)
    this.audioManager = new AudioManager(this.camera, this.scene)

    this.setupLights()

    this.clock = new THREE.Clock()
    this.gameStateStore = new GameStateStore()
    this.updateProceduralSky(this.gameStateStore.getRoomId())
    new GameAudioSystem(this.audioManager, this.gameStateStore)
    this.trackScene = new TrackScene(
      this.scene,
      this.camera,
      this.cameraRig,
      this.gameStateStore,
      this.keyLight,
      this.fillLight,
      this.rimLight,
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
    this.radioSystem = new RadioSystem(
      this.scene,
      this.camera,
      this.audioManager,
      this.gameStateStore,
      this.socketClient,
    )
    this.bindSocketHandlers()
    this.socketClient.connect()

    this.bindDomEvents()
    this.animate()
  }

  private createRenderer(container: HTMLElement): THREE.WebGLRenderer {
    const devicePixelRatio = window.devicePixelRatio || 1
    const renderer = new THREE.WebGLRenderer({ antialias: devicePixelRatio > 1 })
    renderer.setPixelRatio(Math.min(devicePixelRatio, this.maxPixelRatio))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.7
    renderer.physicallyCorrectLights = false
    renderer.domElement.classList.add('canvas-container')
    container.appendChild(renderer.domElement)
    return renderer
  }

  private createCamera(container: HTMLElement): THREE.PerspectiveCamera {
    const aspect = container.clientWidth / container.clientHeight
    return new THREE.PerspectiveCamera(45, aspect, 0.1, 20000)
  }

  private addDirectionalLight(
    color: number,
    intensity: number,
    position: { x: number; y: number; z: number },
  ): THREE.DirectionalLight {
    const light = new THREE.DirectionalLight(color, intensity)
    light.position.set(position.x, position.y, position.z)
    this.scene.add(light)
    this.scene.add(light.target)
    return light
  }

  private setupLights(): void {
    const ambient = new THREE.AmbientLight(0xf3e5cf, 0.32)
    this.scene.add(ambient)

    const hemisphere = new THREE.HemisphereLight(0xcad8ff, 0x6b4b38, 0.2)
    this.scene.add(hemisphere)

    const keyLight = this.addDirectionalLight(0xfff1d6, 0.8, { x: 70, y: 220, z: 60 })
    keyLight.castShadow = true
    this.updateShadowMapSize(keyLight)
    keyLight.shadow.bias = -0.0001
    keyLight.shadow.normalBias = 0.02
    keyLight.shadow.camera.near = 1
    keyLight.shadow.camera.far = 450
    keyLight.shadow.camera.left = -140
    keyLight.shadow.camera.right = 140
    keyLight.shadow.camera.top = 140
    keyLight.shadow.camera.bottom = -140
    const fillLight = this.addDirectionalLight(0xffe3bf, 0.3, { x: -140, y: 180, z: 120 })
    const rimLight = this.addDirectionalLight(0xa8c2ff, 0.2, { x: 150, y: 160, z: -140 })

    this.keyLight = keyLight
    this.fillLight = fillLight
    this.rimLight = rimLight
  }

  private setupEnvironment(): void {
    const fallback = this.createGradientEnvironmentMap()
    if (fallback) {
      this.setEnvironmentMap(fallback)
    }
    if (HDR_BACKGROUND_ENABLED) {
      void this.loadHdrEnvironment()
    }
  }

  private createGradientEnvironmentMap(): THREE.Texture | null {
    const width = 1024
    const height = 512
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      return null
    }

    const gradient = context.createLinearGradient(0, 0, 0, height)
    gradient.addColorStop(0, '#f4e8d5')
    gradient.addColorStop(1, '#8c6b53')
    context.fillStyle = gradient
    context.fillRect(0, 0, width, height)

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.mapping = THREE.EquirectangularReflectionMapping

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer)
    const envMap = pmremGenerator.fromEquirectangular(texture).texture
    pmremGenerator.dispose()
    texture.dispose()

    return envMap
  }

  private setEnvironmentMap(envMap: THREE.Texture): void {
    if (this.environmentMap && this.environmentMap !== envMap) {
      this.environmentMap.dispose()
    }
    this.environmentMap = envMap
    this.scene.environment = envMap
  }

  private setHdrBackground(hdrTexture: THREE.Texture): void {
    if (this.hdrBackground) {
      this.scene.remove(this.hdrBackground)
      this.hdrBackground.geometry.dispose()
      const material = this.hdrBackground.material as THREE.MeshBasicMaterial
      if (material.map) {
        material.map.dispose()
      }
      material.dispose()
      this.hdrBackground = null
    }

    const geometry = new THREE.SphereGeometry(
      SKYBOX_BACKGROUND_CONFIG.radius,
      48,
      32,
    )
    const material = new THREE.MeshBasicMaterial({
      map: hdrTexture,
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    mesh.name = 'hdr-background'
    this.scene.add(mesh)
    this.scene.background = null
    this.hdrBackground = mesh
  }

  private async loadHdrEnvironment(): Promise<void> {
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer)
    try {
      const hdrTexture = await this.hdrLoader.loadAsync(this.skyboxPath)
      hdrTexture.mapping = THREE.EquirectangularReflectionMapping
      const envMap = pmremGenerator.fromEquirectangular(hdrTexture).texture

      this.setEnvironmentMap(envMap)
      if (this.sky) {
        this.sky.mesh.visible = false
      }
      this.setHdrBackground(hdrTexture)
    } catch (error) {
      console.error(`[SceneManager] Failed to load HDR skybox from "${this.skyboxPath}".`, error)
    } finally {
      pmremGenerator.dispose()
    }
  }

  private bindSocketHandlers(): void {
    this.socketClient.onRoomInfo((info) => {
      this.updateProceduralSky(info.roomId)
      this.gameStateStore.setRoomInfo(info.roomId, info.playerId, info.track, info.players, {
        sessionToken: info.sessionToken,
        protocolVersion: info.protocolVersion,
        serverVersion: info.serverVersion,
      })
      this.loadingScreen.markRoomReady()
    })
    this.socketClient.onState((state) => {
      this.gameStateStore.updateState(state)
      this.loadingScreen.markStateReady()
    })
    this.socketClient.onStateDelta((delta) => {
      const applied = this.gameStateStore.applyDelta(delta)
      if (applied) {
        this.loadingScreen.markStateReady()
      }
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
    this.socketClient.onPlayerLeft((player) => {
      this.gameStateStore.removePlayer(player.playerId)
    })
    this.socketClient.onError((message) => {
      console.error(`[SceneManager] ${message}`)
    })
  }

  private bindDomEvents(): void {
    const canvas = this.renderer.domElement
    window.addEventListener('resize', this.handleResize)
    window.addEventListener('keydown', this.handleGlobalKeyDown)
    canvas.addEventListener('contextmenu', this.preventContextMenu)
    canvas.addEventListener('pointerdown', this.handlePointerDown)
    canvas.addEventListener('pointermove', this.handlePointerMove)
    for (const eventType of this.pointerEndEvents) {
      canvas.addEventListener(eventType, this.handlePointerUp)
    }
    canvas.addEventListener('wheel', this.handleWheel, { passive: false })
  }

  private readonly handleResize = (): void => {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)

    if (this.keyLight) {
      this.updateShadowMapSize(this.keyLight)
    }
  }

  private updateShadowMapSize(light: THREE.DirectionalLight): void {
    const maxDimension = Math.max(this.container.clientWidth, this.container.clientHeight)
    const pixelRatio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio)
    const targetSize = maxDimension * pixelRatio
    const clampedSize = THREE.MathUtils.clamp(targetSize, this.minShadowMapSize, this.maxShadowMapSize)
    const powerOfTwoSize = Math.pow(2, Math.round(Math.log2(clampedSize)))

    if (this.lastShadowMapSize === powerOfTwoSize) {
      return
    }

    light.shadow.mapSize.width = powerOfTwoSize
    light.shadow.mapSize.height = powerOfTwoSize
    this.lastShadowMapSize = powerOfTwoSize
  }

  private readonly animate = (): void => {
    requestAnimationFrame(this.animate)
    const delta = this.clock.getDelta()
    this.trackScene.update(delta)
    this.cameraRig.update(delta)
    this.radioSystem.update()
    if (this.sky && this.sky.mesh.visible) {
      this.sky.update(delta, this.camera.position)
    }
    if (this.hdrBackground) {
      this.hdrBackground.position.set(
        this.camera.position.x,
        this.camera.position.y + SKYBOX_BACKGROUND_CONFIG.offsetY,
        this.camera.position.z,
      )
    }
    this.renderer.render(this.scene, this.camera)
  }

  private updateProceduralSky(roomId: string | null): void {
    const shouldEnable = isProceduralSkyEnabled(roomId)
    if (!shouldEnable) {
      if (this.sky?.mesh.parent) {
        this.scene.remove(this.sky.mesh)
      }
      return
    }

    if (!this.sky) {
      this.sky = new ProceduralSky({
        topColor: '#6d9eff',
        middleColor: '#9ccfff',
        bottomColor: '#f6e5d6',
        timeOfDay: 0.25,
      })
    }

    if (!this.sky.mesh.parent) {
      this.scene.add(this.sky.mesh)
    }
    this.sky.mesh.visible = !this.hdrBackground
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
    const consume = (): void => {
      event.preventDefault()
      event.stopPropagation()
    }

    if (matchesKey('s')) {
      this.audioManager.toggle()
      consume()
    } else if (matchesKey('q')) {
      this.controllerAccess.toggleVisibility()
      consume()
    } else if (matchesKey('p')) {
      this.playerListOverlay.toggleVisibility()
      consume()
    } else if (matchesKey('h')) {
      this.raceHud.toggleVisibility()
      consume()
    } else if (matchesKey('r')) {
      this.cameraRig.toggleAutoOrbit()
      consume()
    }
  }

  private readonly handlePlayerAutoFollow = (): void => {
    this.controllerAccess.hide()
  }

  private readonly handleSelectPlayer = (playerId: string): void => {
    this.trackScene.setFollowTarget(playerId)
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button === 0) {
      this.radioPointerId = event.pointerId
      this.radioPointerStart.set(event.clientX, event.clientY)
      this.radioPointerMoved = false
      this.renderer.domElement.setPointerCapture(event.pointerId)
      return
    }

    if (event.button !== 2 || this.cameraRig.isFollowing()) {
      return
    }
    this.isOrbitDragging = true
    this.orbitPointerId = event.pointerId
    this.lastPointerPosition.set(event.clientX, event.clientY)
    this.renderer.domElement.setPointerCapture(event.pointerId)
    this.cameraRig.beginManualOrbit()
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.radioPointerId === event.pointerId && !this.radioPointerMoved) {
      const dx = event.clientX - this.radioPointerStart.x
      const dy = event.clientY - this.radioPointerStart.y
      if (dx * dx + dy * dy > this.radioClickTolerance * this.radioClickTolerance) {
        this.radioPointerMoved = true
      }
    }

    if (!this.isOrbitDragging || this.orbitPointerId !== event.pointerId) {
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
    if (this.orbitPointerId === event.pointerId) {
      this.renderer.domElement.releasePointerCapture(event.pointerId)
      this.isOrbitDragging = false
      this.orbitPointerId = null
      this.cameraRig.endManualOrbit()
    }

    if (this.radioPointerId === event.pointerId) {
      this.renderer.domElement.releasePointerCapture(event.pointerId)
      this.radioPointerId = null
      if (!this.radioPointerMoved && event.type === 'pointerup') {
        this.radioSystem.handlePointerClick(event, this.renderer.domElement)
      }
    }
  }

  private readonly handleWheel = (event: WheelEvent): void => {
    if (this.cameraRig.isFollowing()) {
      return
    }
    event.preventDefault()
    const factor = 1 + Math.sign(event.deltaY) * this.zoomStep
    this.cameraRig.adjustZoom(factor)
  }

  dispose(): void {
    window.removeEventListener('resize', this.handleResize)
    window.removeEventListener('keydown', this.handleGlobalKeyDown)
    const canvas = this.renderer.domElement
    canvas.removeEventListener('contextmenu', this.preventContextMenu)
    canvas.removeEventListener('pointerdown', this.handlePointerDown)
    canvas.removeEventListener('pointermove', this.handlePointerMove)
    for (const eventType of this.pointerEndEvents) {
      canvas.removeEventListener(eventType, this.handlePointerUp)
    }
    canvas.removeEventListener('wheel', this.handleWheel)
    this.loadingScreen.unbindLoadingManager()
    this.radioSystem.dispose()
    this.trackScene.dispose()
    this.playerListOverlay.dispose()
    this.controllerAccess.dispose()
    this.audioManager.dispose()
    this.socketClient.disconnect()
  }
}
