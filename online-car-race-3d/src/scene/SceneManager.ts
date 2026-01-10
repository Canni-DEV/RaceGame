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
  private readonly gameAudio: GameAudioSystem
  private keyLight: THREE.DirectionalLight | null = null
  private isOrbitDragging = false
  private orbitPointerId: number | null = null
  private readonly lastPointerPosition = new THREE.Vector2()
  private readonly orbitRotateSpeed = 0.005
  private readonly orbitTiltSpeed = 0.0035
  private readonly zoomStep = 0.08
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
    const devicePixelRatio = window.devicePixelRatio || 1
    this.renderer = new THREE.WebGLRenderer({ antialias: devicePixelRatio > 1 })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.maxPixelRatio))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NoToneMapping
    this.renderer.toneMappingExposure = 1
    this.renderer.physicallyCorrectLights = false
    this.renderer.domElement.classList.add('canvas-container')
    this.container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.setupEnvironment()

    const aspect = container.clientWidth / container.clientHeight
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 20000)

    // Mantener el listener de audio acoplado a la cámara y dentro de la escena
    this.scene.add(this.camera)

    this.cameraRig = new CameraRig(this.camera)
    this.audioManager = new AudioManager(this.camera, this.scene)

    this.setupLights()

    this.clock = new THREE.Clock()
    this.gameStateStore = new GameStateStore()
    this.updateProceduralSky(this.gameStateStore.getRoomId())
    this.gameAudio = new GameAudioSystem(this.audioManager, this.gameStateStore)
    void this.gameAudio
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
      this.updateProceduralSky(info.roomId)
      this.gameStateStore.setRoomInfo(info.roomId, info.playerId, info.track, info.players, {
        sessionToken: info.sessionToken,
        protocolVersion: info.protocolVersion,
        serverVersion: info.serverVersion,
      })
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
    const hemisphere = new THREE.HemisphereLight(0x6fa5ff, 0x7a552d, 0.35)
    this.scene.add(hemisphere)

    const keyLight = new THREE.DirectionalLight(0xffe2b3, 1.15)
    keyLight.position.set(60, 1000, 80)
    keyLight.castShadow = true
    this.updateShadowMapSize(keyLight)
    keyLight.shadow.bias = -0.00005
    keyLight.shadow.normalBias = 0.012
    keyLight.shadow.camera.near = 0.5
    keyLight.shadow.camera.far = 600
    keyLight.shadow.camera.left = -150
    keyLight.shadow.camera.right = 150
    keyLight.shadow.camera.top = 150
    keyLight.shadow.camera.bottom = -150
    this.scene.add(keyLight)
    this.scene.add(keyLight.target)

    this.keyLight = keyLight
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
    gradient.addColorStop(0, '#182c47')
    gradient.addColorStop(1, '#0f0c17')
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
    if (this.orbitPointerId !== event.pointerId) {
      return
    }
    this.renderer.domElement.releasePointerCapture(event.pointerId)
    this.isOrbitDragging = false
    this.orbitPointerId = null
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
