import * as THREE from 'three'
import { CameraRig } from '../render/CameraRig'
import { SocketClient } from '../net/SocketClient'
import { GameStateStore } from '../state/GameStateStore'
import { TrackScene } from './TrackScene'
import { ViewerControllerAccess } from './ViewerControllerAccess'
import { PlayerListOverlay } from './PlayerListOverlay'
import { HotkeyOverlay } from './HotkeyOverlay'
import { AudioManager } from '../audio/AudioManager'
import { RaceHud } from './RaceHud'
import { VisualManager } from '../render/VisualManager'

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
  private readonly visualManager: VisualManager
  private isOrbitDragging = false
  private orbitPointerId: number | null = null
  private lastPointerPosition: { x: number; y: number } | null = null
  private readonly orbitRotateSpeed = 0.005
  private readonly orbitTiltSpeed = 0.0035
  private readonly zoomStep = 0.08

  constructor(container: HTMLElement) {
    this.container = container
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.35
    this.renderer.physicallyCorrectLights = true
    this.renderer.domElement.classList.add('canvas-container')
    this.container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()

    const aspect = container.clientWidth / container.clientHeight
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000)

    // Mantener el listener de audio acoplado a la cámara y dentro de la escena
    this.scene.add(this.camera)

    this.cameraRig = new CameraRig(this.camera)
    this.audioManager = new AudioManager(this.camera)
    this.visualManager = new VisualManager(this.scene, this.renderer, this.camera)

    this.clock = new THREE.Clock()
    this.gameStateStore = new GameStateStore()
    this.trackScene = new TrackScene(
      this.scene,
      this.camera,
      this.cameraRig,
      this.gameStateStore,
      null,
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

  private readonly handleResize = (): void => {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
    this.visualManager.setSize(width, height)
  }

  private readonly animate = (): void => {
    requestAnimationFrame(this.animate)
    const delta = this.clock.getDelta()
    this.trackScene.update(delta)
    this.cameraRig.update(delta)
    this.visualManager.render()
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
