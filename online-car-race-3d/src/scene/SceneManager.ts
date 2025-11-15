import * as THREE from 'three'
import { CameraRig } from '../render/CameraRig'
import { SocketClient } from '../net/SocketClient'
import { GameStateStore } from '../state/GameStateStore'
import { TrackScene } from './TrackScene'

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

  constructor(container: HTMLElement) {
    this.container = container
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.domElement.classList.add('canvas-container')
    this.container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x0a0c0f)

    const aspect = container.clientWidth / container.clientHeight
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000)

    this.cameraRig = new CameraRig(this.camera)

    this.setupLights()

    this.clock = new THREE.Clock()
    this.gameStateStore = new GameStateStore()
    this.trackScene = new TrackScene(
      this.scene,
      this.camera,
      this.cameraRig,
      this.gameStateStore,
    )

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
    this.animate()
  }

  private setupLights(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.25)
    this.scene.add(ambient)

    const directional = new THREE.DirectionalLight(0xf0f0ff, 0.9)
    directional.position.set(60, 80, 40)
    directional.castShadow = true
    directional.shadow.mapSize.width = 2048
    directional.shadow.mapSize.height = 2048
    directional.shadow.camera.near = 10
    directional.shadow.camera.far = 200
    directional.shadow.camera.left = -100
    directional.shadow.camera.right = 100
    directional.shadow.camera.top = 100
    directional.shadow.camera.bottom = -100
    this.scene.add(directional)
  }

  private readonly handleResize = (): void => {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  private readonly animate = (): void => {
    requestAnimationFrame(this.animate)
    const delta = this.clock.getDelta()
    this.trackScene.update(delta)
    this.cameraRig.update(delta)
    this.renderer.render(this.scene, this.camera)
  }
}
