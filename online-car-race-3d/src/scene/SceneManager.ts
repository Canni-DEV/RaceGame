import * as THREE from 'three'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js'
import { HueSaturationShader } from 'three/examples/jsm/shaders/HueSaturationShader.js'
import { BrightnessContrastShader } from 'three/examples/jsm/shaders/BrightnessContrastShader.js'
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
import { RoomVideoScreen } from './RoomVideoScreen'
import { DebugCameraController } from './DebugCameraController'
import { ChatOverlay } from './ChatOverlay'

const DEFAULT_HDR_SKYBOX = 'textures/empty_play_room_4k.hdr'
const SKYBOX_BACKGROUND_CONFIG = {
  radius: 900,
  offsetY: -20,
}

type ResizablePass = {
  setSize: (width: number, height: number) => void
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
const DEBUG_CAMERA_ENABLED = getEnvFlag('VITE_DEBUG_CAMERA', false)
const POST_PROCESSING_ENABLED = getEnvFlag('VITE_ENABLE_POST_PROCESSING', true)

const POST_PROCESSING_CONFIG = {
  ssao: {
    kernelRadius: 10,
    minDistance: 0.004,
    maxDistance: 0.14,
  },
  dof: {
    aperture: 0.00005,
    maxBlur: 0.008,
  },
  bloom: {
    strength: 0.45,
    radius: 0.45,
    threshold: 0.78,
  },
  vignette: {
    offset: 0.95,
    darkness: 1.12,
  },
  grade: {
    saturation: 0.12,
    brightness: 0.02,
    contrast: 0.1,
  },
}

const OVERHEAD_SPOT_CONFIG = {
  color: 0xffddba,
  intensity: 0.55,
  distance: 0,
  angle: THREE.MathUtils.degToRad(42),
  penumbra: 0.5,
  decay: 1.1,
  height: 250,
}

const LAMP_LIGHT_CONFIG = {
  color: 0xf7b98a,
  intensity: 0.35,
  distance: 900,
  decay: 1.2,
}

const LAMP_LIGHT_OFFSET = new THREE.Vector3(-180, 170, -260)

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
  private readonly roomVideoScreen: RoomVideoScreen
  private readonly debugCamera: DebugCameraController | null
  private keyLight: THREE.DirectionalLight | null = null
  private fillLight: THREE.DirectionalLight | null = null
  private rimLight: THREE.DirectionalLight | null = null
  private overheadSpot: THREE.SpotLight | null = null
  private accentLight: THREE.PointLight | null = null
  private composer: EffectComposer | null = null
  private ssaoPass: SSAOPass | null = null
  private bokehPass: BokehPass | null = null
  private bloomPass: UnrealBloomPass | null = null
  private readonly focusPoint = new THREE.Vector3()
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
    this.debugCamera = DEBUG_CAMERA_ENABLED ? new DebugCameraController(this.camera) : null

    this.setupLights()
    this.setupPostProcessing()

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
      this.handleTrackCenterChange,
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
    new ChatOverlay(this.container, this.gameStateStore, this.socketClient)
    this.radioSystem = new RadioSystem(
      this.scene,
      this.camera,
      this.audioManager,
      this.gameStateStore,
      this.socketClient,
    )
    this.roomVideoScreen = new RoomVideoScreen(this.scene)
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
    renderer.toneMappingExposure = 0.72
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
    const ambient = new THREE.AmbientLight(0xe7d3b4, 0.12)
    this.scene.add(ambient)

    const hemisphere = new THREE.HemisphereLight(0xb1c9e6, 0x5a3b2a, 0.08)
    this.scene.add(hemisphere)

    const keyLight = this.addDirectionalLight(0xffd7b0, 0.75, { x: 50, y: 240, z: 80 })
    keyLight.castShadow = true
    this.updateShadowMapSize(keyLight)
    keyLight.shadow.bias = -0.00015
    keyLight.shadow.normalBias = 0.012
    keyLight.shadow.radius = 2
    keyLight.shadow.camera.near = 1
    keyLight.shadow.camera.far = 450
    keyLight.shadow.camera.left = -140
    keyLight.shadow.camera.right = 140
    keyLight.shadow.camera.top = 140
    keyLight.shadow.camera.bottom = -140
    const fillLight = this.addDirectionalLight(0xa6c7ff, 0.3, { x: -120, y: 150, z: 60 })
    const rimLight = this.addDirectionalLight(0xf2b88a, 0.22, { x: 170, y: 160, z: -120 })

    const overheadSpot = new THREE.SpotLight(
      OVERHEAD_SPOT_CONFIG.color,
      OVERHEAD_SPOT_CONFIG.intensity,
      OVERHEAD_SPOT_CONFIG.distance,
      OVERHEAD_SPOT_CONFIG.angle,
      OVERHEAD_SPOT_CONFIG.penumbra,
      OVERHEAD_SPOT_CONFIG.decay,
    )
    overheadSpot.position.set(0, OVERHEAD_SPOT_CONFIG.height, 0)
    overheadSpot.target.position.set(0, 0, 0)
    this.scene.add(overheadSpot)
    this.scene.add(overheadSpot.target)

    const accentLight = new THREE.PointLight(
      LAMP_LIGHT_CONFIG.color,
      LAMP_LIGHT_CONFIG.intensity,
      LAMP_LIGHT_CONFIG.distance,
      LAMP_LIGHT_CONFIG.decay,
    )
    accentLight.position.copy(LAMP_LIGHT_OFFSET)
    this.scene.add(accentLight)

    this.keyLight = keyLight
    this.fillLight = fillLight
    this.rimLight = rimLight
    this.overheadSpot = overheadSpot
    this.accentLight = accentLight
  }

  private setupPostProcessing(): void {
    if (!POST_PROCESSING_ENABLED) {
      return
    }
    const width = this.container.clientWidth
    const height = this.container.clientHeight

    const composer = new EffectComposer(this.renderer)
    composer.setSize(width, height)
    composer.addPass(new RenderPass(this.scene, this.camera))

    const ssaoPass = new SSAOPass(this.scene, this.camera, width, height)
    ssaoPass.kernelRadius = POST_PROCESSING_CONFIG.ssao.kernelRadius
    ssaoPass.minDistance = POST_PROCESSING_CONFIG.ssao.minDistance
    ssaoPass.maxDistance = POST_PROCESSING_CONFIG.ssao.maxDistance
    composer.addPass(ssaoPass)

    const bokehPass = new BokehPass(this.scene, this.camera, {
      focus: 200,
      aperture: POST_PROCESSING_CONFIG.dof.aperture,
      maxblur: POST_PROCESSING_CONFIG.dof.maxBlur,
      width,
      height,
    })
    composer.addPass(bokehPass)

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      POST_PROCESSING_CONFIG.bloom.strength,
      POST_PROCESSING_CONFIG.bloom.radius,
      POST_PROCESSING_CONFIG.bloom.threshold,
    )
    composer.addPass(bloomPass)

    const saturationPass = new ShaderPass(HueSaturationShader)
    saturationPass.uniforms.hue.value = 0
    saturationPass.uniforms.saturation.value = POST_PROCESSING_CONFIG.grade.saturation
    composer.addPass(saturationPass)

    const gradePass = new ShaderPass(BrightnessContrastShader)
    gradePass.uniforms.brightness.value = POST_PROCESSING_CONFIG.grade.brightness
    gradePass.uniforms.contrast.value = POST_PROCESSING_CONFIG.grade.contrast
    composer.addPass(gradePass)

    const vignettePass = new ShaderPass(VignetteShader)
    vignettePass.uniforms.offset.value = POST_PROCESSING_CONFIG.vignette.offset
    vignettePass.uniforms.darkness.value = POST_PROCESSING_CONFIG.vignette.darkness
    composer.addPass(vignettePass)

    this.composer = composer
    this.ssaoPass = ssaoPass
    this.bokehPass = bokehPass
    this.bloomPass = bloomPass
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
    window.addEventListener('keyup', this.handleGlobalKeyUp)
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
    this.updatePostProcessingSize(width, height)

    if (this.keyLight) {
      this.updateShadowMapSize(this.keyLight)
    }
  }

  private updatePostProcessingSize(width: number, height: number): void {
    if (!this.composer) {
      return
    }
    this.composer.setSize(width, height)
    const resizePass = (pass: ResizablePass | null): void => {
      if (pass) {
        pass.setSize(width, height)
      }
    }
    resizePass(this.ssaoPass as ResizablePass | null)
    resizePass(this.bokehPass as ResizablePass | null)
    resizePass(this.bloomPass as ResizablePass | null)
  }

  private updatePostProcessingFocus(): void {
    if (!this.bokehPass) {
      return
    }
    this.cameraRig.getLookTarget(this.focusPoint)
    const focusDistance = this.camera.position.distanceTo(this.focusPoint)
    this.bokehPass.materialBokeh.uniforms.focus.value = focusDistance
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
    if (this.debugCamera) {
      this.debugCamera.update(delta)
    } else {
      this.cameraRig.update(delta)
    }
    this.radioSystem.update()
    this.roomVideoScreen.update()
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
    this.updatePostProcessingFocus()
    if (this.composer) {
      this.composer.render()
    } else {
      this.renderer.render(this.scene, this.camera)
    }
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
    if (this.debugCamera && this.debugCamera.handleKeyDown(event)) {
      event.preventDefault()
      event.stopPropagation()
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

  private readonly handleGlobalKeyUp = (event: KeyboardEvent): void => {
    if (this.debugCamera && this.debugCamera.handleKeyUp(event)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  private readonly handlePlayerAutoFollow = (): void => {
    this.controllerAccess.hide()
  }

  private readonly handleTrackCenterChange = (center: THREE.Vector3): void => {
    if (this.debugCamera) {
      this.debugCamera.setReferencePoint(center)
    }
    this.updateAccentLights(center)
  }

  private updateAccentLights(center: THREE.Vector3): void {
    if (this.overheadSpot) {
      this.overheadSpot.position.set(
        center.x,
        center.y + OVERHEAD_SPOT_CONFIG.height,
        center.z,
      )
      this.overheadSpot.target.position.copy(center)
      this.overheadSpot.target.updateMatrixWorld()
    }
    if (this.accentLight) {
      this.accentLight.position.copy(center).add(LAMP_LIGHT_OFFSET)
    }
  }

  private readonly handleSelectPlayer = (playerId: string): void => {
    this.trackScene.setFollowTarget(playerId)
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.debugCamera && this.debugCamera.handlePointerDown(event)) {
      this.renderer.domElement.setPointerCapture(event.pointerId)
      return
    }
    if (event.button === 0) {
      this.radioPointerId = event.pointerId
      this.radioPointerStart.set(event.clientX, event.clientY)
      this.radioPointerMoved = false
      this.renderer.domElement.setPointerCapture(event.pointerId)
      return
    }

    if (event.button !== 2 || this.cameraRig.isInputLocked()) {
      return
    }
    this.isOrbitDragging = true
    this.orbitPointerId = event.pointerId
    this.lastPointerPosition.set(event.clientX, event.clientY)
    this.renderer.domElement.setPointerCapture(event.pointerId)
    this.cameraRig.beginManualOrbit()
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.debugCamera && this.debugCamera.handlePointerMove(event)) {
      return
    }
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
    if (this.debugCamera && this.debugCamera.handlePointerUp(event)) {
      this.renderer.domElement.releasePointerCapture(event.pointerId)
      return
    }
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
    if (this.debugCamera) {
      event.preventDefault()
      return
    }
    if (this.cameraRig.isInputLocked()) {
      return
    }
    event.preventDefault()
    const factor = 1 + Math.sign(event.deltaY) * this.zoomStep
    this.cameraRig.adjustZoom(factor)
  }

  dispose(): void {
    window.removeEventListener('resize', this.handleResize)
    window.removeEventListener('keydown', this.handleGlobalKeyDown)
    window.removeEventListener('keyup', this.handleGlobalKeyUp)
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
    this.composer?.dispose()
    this.socketClient.disconnect()
  }
}
