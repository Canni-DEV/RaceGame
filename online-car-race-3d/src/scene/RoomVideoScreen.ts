import * as THREE from 'three'
import { resolvePublicAssetUrl } from '../config'
import { getNumberEnv, getStringEnv } from '../core/env'

type RoomVideoConfig = {
  url: string | null
  nodeName: string | null
  offset: THREE.Vector3
  rotation: THREE.Euler
  width: number
  height: number
  scale: number
  doubleSided: boolean
  lightColor: number
  lightIntensity: number
  lightDistance: number
  lightDecay: number
  lightOffset: THREE.Vector3
}

const ROOM_MODEL_NAME = 'room-model'
const SCREEN_ANCHOR_NAME = 'room-video-anchor'
const SCREEN_MESH_NAME = 'room-video-screen'

const getRoomVideoConfig = (): RoomVideoConfig => {
  const rawUrl = getStringEnv('VITE_ROOM_VIDEO_URL', 'Football.webm')
  const url = rawUrl ? resolvePublicAssetUrl(rawUrl) : null
  const width = Math.max(0.01, getNumberEnv('VITE_ROOM_VIDEO_WIDTH', 0.84))
  const height = Math.max(0.01, getNumberEnv('VITE_ROOM_VIDEO_HEIGHT', 0.65))
  const scale = Math.max(0.0001, getNumberEnv('VITE_ROOM_VIDEO_SCALE', 1.8))
  return {
    url,
    nodeName: getStringEnv('VITE_ROOM_VIDEO_NODE', 'Sketchfab_model.004'),
    offset: new THREE.Vector3(
      getNumberEnv('VITE_ROOM_VIDEO_OFFSET_X', 0.65),
      getNumberEnv('VITE_ROOM_VIDEO_OFFSET_Y', -0.715),
      getNumberEnv('VITE_ROOM_VIDEO_OFFSET_Z', -0.25),
    ),
    rotation: new THREE.Euler(
      THREE.MathUtils.degToRad(getNumberEnv('VITE_ROOM_VIDEO_ROT_X', 90)),
      THREE.MathUtils.degToRad(getNumberEnv('VITE_ROOM_VIDEO_ROT_Y', 25)),
      THREE.MathUtils.degToRad(getNumberEnv('VITE_ROOM_VIDEO_ROT_Z', 0)),
    ),
    width,
    height,
    scale,
    doubleSided: getNumberEnv('VITE_ROOM_VIDEO_DOUBLE_SIDED', 0) === 1,
    lightColor: getNumberEnv('VITE_ROOM_VIDEO_LIGHT_COLOR', 0x9cc8ff),
    lightIntensity: Math.max(0, getNumberEnv('VITE_ROOM_VIDEO_LIGHT_INTENSITY', 1.4)),
    lightDistance: Math.max(0, getNumberEnv('VITE_ROOM_VIDEO_LIGHT_DISTANCE', 600)),
    lightDecay: Math.max(0, getNumberEnv('VITE_ROOM_VIDEO_LIGHT_DECAY', 2)),
    lightOffset: new THREE.Vector3(
      getNumberEnv('VITE_ROOM_VIDEO_LIGHT_OFFSET_X', 0),
      getNumberEnv('VITE_ROOM_VIDEO_LIGHT_OFFSET_Y', 0),
      getNumberEnv('VITE_ROOM_VIDEO_LIGHT_OFFSET_Z', 0.08),
    ),
  }
}

export class RoomVideoScreen {
  private readonly scene: THREE.Scene
  private readonly config: RoomVideoConfig
  private anchor: THREE.Object3D | null = null
  private texture: THREE.VideoTexture | null = null
  private screenLight: THREE.PointLight | null = null
  private warnedMissingNode = false

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.config = getRoomVideoConfig()
    if (this.config.url) {
      this.prepareVideo(this.config.url)
    }
  }

  update(): void {
    if (!this.texture) {
      return
    }
    this.ensureAnchor()
  }

  private prepareVideo(url: string): void {
    const video = document.createElement('video')
    video.src = url
    video.loop = true
    video.muted = true
    video.autoplay = true
    video.playsInline = true
    video.preload = 'auto'
    video.setAttribute('playsinline', 'true')
    video.setAttribute('webkit-playsinline', 'true')
    video.crossOrigin = 'anonymous'
    video.disablePictureInPicture = true

    const texture = new THREE.VideoTexture(video)
    texture.colorSpace = THREE.SRGBColorSpace

    this.texture = texture

    const startPlayback = (): void => {
      const playPromise = video.play()
      if (playPromise) {
        playPromise.catch(() => undefined)
      }
    }

    if (video.readyState >= 2) {
      startPlayback()
    } else {
      video.addEventListener('canplay', startPlayback, { once: true })
    }
  }

  private ensureAnchor(): void {
    if (this.anchor && this.isInScene(this.anchor)) {
      return
    }

    this.anchor = null
    const roomModel = this.scene.getObjectByName(ROOM_MODEL_NAME)
    if (!roomModel) {
      return
    }

    const anchor = this.resolveAnchor(roomModel)
    if (!anchor) {
      return
    }

    this.anchor = anchor
    this.ensureScreen(anchor)
  }

  private isInScene(object: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = object
    while (current) {
      if (current === this.scene) {
        return true
      }
      current = current.parent
    }
    return false
  }

  private resolveAnchor(roomModel: THREE.Object3D): THREE.Object3D | null {
    const baseNode = this.findNamedNode(roomModel)
    if (!baseNode) {
      if (!this.warnedMissingNode) {
        const target = this.config.nodeName ?? '(none)'
        console.warn(
          `[RoomVideoScreen] Node "${target}" not found inside room model.`,
        )
        this.warnedMissingNode = true
      }
      return null
    }

    const existing = baseNode.getObjectByName(SCREEN_ANCHOR_NAME)
    const anchor = existing ?? new THREE.Object3D()
    anchor.name = SCREEN_ANCHOR_NAME
    anchor.position.copy(this.config.offset)
    anchor.rotation.set(this.config.rotation.x, this.config.rotation.y, this.config.rotation.z)
    anchor.scale.setScalar(this.config.scale)
    if (!existing) {
      baseNode.add(anchor)
    }
    return anchor
  }

  private findNamedNode(roomModel: THREE.Object3D): THREE.Object3D | null {
    if (!this.config.nodeName) {
      return null
    }
    const target = this.config.nodeName.trim()
    if (!target) {
      return null
    }
    const exact = roomModel.getObjectByName(target)
    if (exact) {
      return exact
    }

    const targetLower = target.toLowerCase()
    const normalizedTarget = this.normalizeNodeName(target)
    let caseMatch: THREE.Object3D | null = null
    let normalizedMatch: THREE.Object3D | null = null
    let partialMatch: THREE.Object3D | null = null

    roomModel.traverse((child) => {
      if (!child.name) {
        return
      }
      const nameLower = child.name.toLowerCase()
      if (!caseMatch && nameLower === targetLower) {
        caseMatch = child
        return
      }
      if (!normalizedMatch && this.normalizeNodeName(child.name) === normalizedTarget) {
        normalizedMatch = child
        return
      }
      if (
        !partialMatch &&
        (nameLower.includes(targetLower) || targetLower.includes(nameLower))
      ) {
        partialMatch = child
      }
    })

    return caseMatch ?? normalizedMatch ?? partialMatch
  }

  private normalizeNodeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '')
  }

  private ensureScreen(anchor: THREE.Object3D): void {
    if (!this.texture) {
      return
    }

    const existing = anchor.getObjectByName(SCREEN_MESH_NAME)
    if (existing && (existing as THREE.Mesh).isMesh) {
      return
    }

    const geometry = new THREE.PlaneGeometry(this.config.width, this.config.height)
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      side: this.config.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      toneMapped: false,
    })

    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = SCREEN_MESH_NAME
    anchor.add(mesh)
    this.ensureScreenLight(anchor)
  }

  private ensureScreenLight(anchor: THREE.Object3D): void {
    if (this.config.lightIntensity <= 0) {
      return
    }
    if (!this.screenLight) {
      this.screenLight = new THREE.PointLight(
        this.config.lightColor,
        this.config.lightIntensity,
        this.config.lightDistance,
        this.config.lightDecay,
      )
    }

    this.screenLight.color.setHex(this.config.lightColor)
    this.screenLight.intensity = this.config.lightIntensity
    this.screenLight.distance = this.config.lightDistance
    this.screenLight.decay = this.config.lightDecay
    this.screenLight.position.copy(this.config.lightOffset)

    if (this.screenLight.parent !== anchor) {
      anchor.add(this.screenLight)
    }
  }
}
