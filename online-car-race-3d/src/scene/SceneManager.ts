import * as THREE from 'three'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { resolvePublicAssetUrl } from '../config'
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
import { LoadingScreen } from './LoadingScreen'
import { RadioSystem } from './RadioSystem'
import { RoomVideoScreen } from './RoomVideoScreen'
import { DebugCameraController } from './DebugCameraController'
import { ChatOverlay } from './ChatOverlay'
import { RENDER_CONFIG } from '../render/RenderConfig'

const DEFAULT_HDR_SKYBOX = 'textures/empty_play_room_4k.hdr'

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

const HDR_ENVIRONMENT_ENABLED = getEnvFlag('VITE_ENABLE_HDR_BACKGROUND', false)
const DEBUG_CAMERA_ENABLED = getEnvFlag('VITE_DEBUG_CAMERA', false)

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
  private readonly loadingScreen: LoadingScreen
  private readonly radioSystem: RadioSystem
  private readonly roomVideoScreen: RoomVideoScreen
  private readonly debugCamera: DebugCameraController | null
  private keyLight: THREE.DirectionalLight | null = null
  private spotLight: THREE.SpotLight | null = null
  private composer: EffectComposer | null = null
  private bloomPass: UnrealBloomPass | null = null
  private ssaoPass: SSAOPass | null = null
  private readonly lightDebugEnabled = DEBUG_CAMERA_ENABLED
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
  private readonly minShadowMapSize = RENDER_CONFIG.renderer.shadowMapSize.min
  private readonly maxShadowMapSize = RENDER_CONFIG.renderer.shadowMapSize.max
  private readonly maxPixelRatio = RENDER_CONFIG.renderer.maxPixelRatio
  private lastShadowMapSize: number | null = null
  private environmentMap: THREE.Texture | null = null
  private readonly hdrLoader = new HDRLoader()
  private readonly skyboxPath = getSkyboxUrl()
  private readonly focusPoint = new THREE.Vector3()

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

    this.clock = new THREE.Clock()
    this.gameStateStore = new GameStateStore()
    new GameAudioSystem(this.audioManager, this.gameStateStore)
    this.trackScene = new TrackScene(
      this.scene,
      this.camera,
      this.cameraRig,
      this.gameStateStore,
      this.keyLight,
      null,
      null,
      this.spotLight,
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
    this.setupPostProcessing()
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
    renderer.toneMappingExposure = RENDER_CONFIG.renderer.toneMappingExposure
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
    if (this.lightDebugEnabled) {
      light.add(this.createLightMarker(color))
    }
    return light
  }

  private setupLights(): void {
    const ambientConfig = RENDER_CONFIG.lights.ambient
    const ambient = new THREE.AmbientLight(ambientConfig.color, ambientConfig.intensity)
    this.scene.add(ambient)

    const hemisphereConfig = RENDER_CONFIG.lights.hemisphere
    const hemisphere = new THREE.HemisphereLight(
      hemisphereConfig.skyColor,
      hemisphereConfig.groundColor,
      hemisphereConfig.intensity,
    )
    this.scene.add(hemisphere)

    const keyConfig = RENDER_CONFIG.lights.key
    const keyLight = this.addDirectionalLight(
      keyConfig.color,
      keyConfig.intensity,
      keyConfig.position,
    )
    keyLight.castShadow = true
    this.updateShadowMapSize(keyLight)
    keyLight.shadow.bias = keyConfig.shadow.bias
    keyLight.shadow.normalBias = keyConfig.shadow.normalBias
    keyLight.shadow.camera.near = 12
    keyLight.shadow.camera.far = 520
    keyLight.shadow.camera.left = -180
    keyLight.shadow.camera.right = 180
    keyLight.shadow.camera.top = 180
    keyLight.shadow.camera.bottom = -180
    const spotConfig = RENDER_CONFIG.lights.practical
    const spotLight = new THREE.SpotLight(
      spotConfig.color,
      spotConfig.intensity,
      spotConfig.distance,
      THREE.MathUtils.degToRad(spotConfig.angleDeg),
      spotConfig.penumbra,
      spotConfig.decay,
    )
    spotLight.position.set(
      spotConfig.positionOffset.x,
      spotConfig.positionOffset.y,
      spotConfig.positionOffset.z,
    )
    spotLight.castShadow = Boolean(spotConfig.castShadow)
    if (spotLight.castShadow) {
      spotLight.shadow.bias = -0.00015
      spotLight.shadow.normalBias = 0.06
      spotLight.shadow.mapSize.set(spotConfig.shadowMapSize, spotConfig.shadowMapSize)
    }
    if (this.lightDebugEnabled) {
      spotLight.add(this.createLightMarker(spotConfig.color, 4))
    }
    this.scene.add(spotLight)
    this.scene.add(spotLight.target)

    this.keyLight = keyLight
    this.spotLight = spotLight
  }

  private createLightMarker(color: THREE.ColorRepresentation, size = 3): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(size, 12, 12)
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      toneMapped: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.9,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    mesh.renderOrder = 10
    return mesh
  }

  private setupEnvironment(): void {
    this.scene.background = null
    const fallback = this.createGradientEnvironmentMap()
    if (fallback) {
      this.setEnvironmentMap(fallback)
    }
    if (HDR_ENVIRONMENT_ENABLED) {
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
    const previous = this.environmentMap
    this.environmentMap = envMap
    this.scene.environment = envMap
    if (previous && previous !== envMap) {
      previous.dispose()
    }
  }

  private async loadHdrEnvironment(): Promise<void> {
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer)
    try {
      const hdrTexture = await this.hdrLoader.loadAsync(this.skyboxPath)
      hdrTexture.mapping = THREE.EquirectangularReflectionMapping
      const envMap = pmremGenerator.fromEquirectangular(hdrTexture).texture

      this.setEnvironmentMap(envMap)
      this.scene.background = null
      hdrTexture.dispose()
    } catch (error) {
      console.error(`[SceneManager] Failed to load HDR skybox from "${this.skyboxPath}".`, error)
    } finally {
      pmremGenerator.dispose()
    }
  }

  private bindSocketHandlers(): void {
    this.socketClient.onRoomInfo((info) => {
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
    this.composer?.setSize(width, height)
    this.updatePostProcessingSize(width, height)

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
    if (this.debugCamera) {
      this.debugCamera.update(delta)
    } else {
      this.cameraRig.update(delta)
    }
    this.radioSystem.update()
    this.roomVideoScreen.update()
    this.renderScene()
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
    this.focusPoint.copy(center)
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
    this.socketClient.disconnect()
    if (this.environmentMap) {
      this.environmentMap.dispose()
      this.environmentMap = null
    }
    this.scene.environment = null
    this.scene.background = null
    if (this.composer) {
      this.composer.dispose()
      this.composer = null
    }
  }

  private setupPostProcessing(): void {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    const composer = new EffectComposer(this.renderer)
    composer.setSize(width, height)

    const renderPass = new RenderPass(this.scene, this.camera)
    composer.addPass(renderPass)

    const ssaoPass = this.createSsaoPass(width, height)
    if (ssaoPass) {
      composer.addPass(ssaoPass)
    }

    const bloomConfig = RENDER_CONFIG.postprocessing.bloom
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      bloomConfig.strength,
      bloomConfig.radius,
      bloomConfig.threshold,
    )
    composer.addPass(bloomPass)

    const vignettePass = this.createVignettePass()
    composer.addPass(vignettePass)

    this.composer = composer
    this.bloomPass = bloomPass
    this.ssaoPass = ssaoPass
  }

  private createSsaoPass(width: number, height: number): SSAOPass | null {
    // SSAO is skipped on contexts that do not support depth textures.
    if (!this.renderer.capabilities || !this.renderer.capabilities.isWebGL2) {
      return null
    }
    const ssaoConfig = RENDER_CONFIG.postprocessing.ssao
    const ssaoPass = new SSAOPass(this.scene, this.camera, width, height)
    ssaoPass.kernelRadius = ssaoConfig.kernelRadius
    ssaoPass.minDistance = ssaoConfig.minDistance
    ssaoPass.maxDistance = ssaoConfig.maxDistance
    ssaoPass.output = SSAOPass.OUTPUT.Default
    return ssaoPass
  }

  private createVignettePass(): ShaderPass {
    const shader = {
      uniforms: {
        tDiffuse: { value: null },
        saturation: { value: 1.08 },
        contrast: { value: 1.05 },
        vignetteOffset: { value: 0.55 },
        vignetteDarkness: { value: 0.4 },
        vignetteStrength: { value: 0.32 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float saturation;
        uniform float contrast;
        uniform float vignetteOffset;
        uniform float vignetteDarkness;
        uniform float vignetteStrength;
        varying vec2 vUv;

        vec3 applySaturation(vec3 color) {
          float luma = dot(color, vec3(0.299, 0.587, 0.114));
          return mix(vec3(luma), color, saturation);
        }

        vec3 applyContrast(vec3 color) {
          return (color - 0.5) * contrast + 0.5;
        }

        void main() {
          vec3 color = texture2D(tDiffuse, vUv).rgb;
          color = applySaturation(color);
          color = applyContrast(color);

          float dist = length(vUv - 0.5);
          float vignette = smoothstep(vignetteOffset, vignetteOffset + vignetteDarkness, dist);
          color *= mix(1.0, 1.0 - vignetteStrength, vignette);

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    }
    return new ShaderPass(shader)
  }

  private updatePostProcessingSize(width: number, height: number): void {
    this.bloomPass?.setSize(width, height)
    this.ssaoPass?.setSize(width, height)
  }

  private renderScene(): void {
    if (this.composer) {
      this.composer.render()
      return
    }
    this.renderer.render(this.scene, this.camera)
  }
}
