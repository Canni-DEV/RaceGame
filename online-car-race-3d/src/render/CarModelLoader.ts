import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import { resolvePublicAssetUrl } from '../config'

const DEFAULT_MODEL_PATH = 'models/Spaceship.glb'
const TARGET_LENGTH = 4.6
const DEBUG_MODEL_STRUCTURE =
  typeof import.meta.env?.VITE_DEBUG_CAR_MODEL_STRUCTURE === 'string'
    ? import.meta.env.VITE_DEBUG_CAR_MODEL_STRUCTURE === 'true'
    : false
const UNTINTED_PART_KEYWORDS = [
  'wheel',
  'tire',
  'rim',
  'glass',
  'window',
  'windshield',
  'windscreen',
  'mirror',
  'wing',
  'alero',
]

type ColorWithChannels = THREE.Color & {
  r: number
  g: number
  b: number
  getHexString(): string
  copy(color: THREE.Color): ColorWithChannels
  set(value: THREE.ColorRepresentation): ColorWithChannels
}

type StandardMaterial = THREE.MeshStandardMaterial & {
  map: THREE.Texture | null
  color: ColorWithChannels
  name: string
  transparent: boolean
  opacity: number
  alphaMap: THREE.Texture | null
  emissive: ColorWithChannels
  emissiveIntensity: number
  toneMapped?: boolean
}

type TextureWithMetadata = THREE.Texture & {
  uuid: string
  colorSpace: unknown
  wrapS: number
  wrapT: number
  offset: { copy: (value: unknown) => void }
  repeat: { copy: (value: unknown) => void }
  rotation: number
  center: { copy: (value: unknown) => void }
  flipY: boolean
  magFilter: number
  minFilter: number
  generateMipmaps: boolean
}

const getConfiguredModelPath = (): string => {
  const candidate = import.meta.env?.VITE_CAR_MODEL_URL
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return resolvePublicAssetUrl(candidate.trim())
  }
  return resolvePublicAssetUrl(DEFAULT_MODEL_PATH)
}

export class CarModelLoader {
  private readonly loader = new GLTFLoader()
  private readonly modelPath: string
  private baseModel: THREE.Object3D | null = null
  private loadPromise: Promise<THREE.Object3D> | null = null
  private readonly tintedTextureCache = new Map<string, THREE.Texture>()

  constructor(modelPath: string = getConfiguredModelPath()) {
    this.modelPath = modelPath
  }

  preload(): Promise<THREE.Object3D> {
    if (this.baseModel) {
      return Promise.resolve(this.baseModel)
    }
    if (!this.loadPromise) {
      this.loadPromise = this.loader
        .loadAsync(this.modelPath)
        .then((gltf: GLTF) => this.prepareModel(gltf.scene))
        .catch((error: unknown) => {
          console.warn(
            `Failed to load car model from "${this.modelPath}". Falling back to procedural mesh.`,
            error,
          )
          return this.prepareModel(this.buildFallbackModel())
        })
        .then((prepared: THREE.Object3D) => {
          this.baseModel = prepared
          return prepared
        })
    }
    return this.loadPromise as Promise<THREE.Object3D>
  }

  async createInstance(color: THREE.Color): Promise<THREE.Object3D> {
    const base = await this.preload()
    const clone = SkeletonUtils.clone(base) as THREE.Object3D
    this.tintMaterials(clone, color)
    return clone
  }

  private prepareModel(model: THREE.Object3D): THREE.Object3D {
    const root = model.clone()
    const pivot = new THREE.Group()
    pivot.name = 'car-pivot'
    pivot.add(root)

    root.updateMatrixWorld(true)
    root.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })

    const bbox = new THREE.Box3().setFromObject(root)
    const center = bbox.getCenter(new THREE.Vector3())
    const min = bbox.min.clone()
    root.position.sub(center)
    root.position.y -= min.y

    const size = bbox.getSize(new THREE.Vector3())
    const length = size.z || 1
    const uniformScale = TARGET_LENGTH / length
    pivot.scale.setScalar(uniformScale)

    if (DEBUG_MODEL_STRUCTURE) {
      this.logModelStructure(pivot)
    }

    return pivot
  }

  private buildFallbackModel(): THREE.Object3D {
    const group = new THREE.Group()
    group.name = 'fallback-car'

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.35,
      roughness: 0.45,
    })

    const cabinMaterial = bodyMaterial.clone()
    cabinMaterial.metalness = 0.15
    cabinMaterial.roughness = 0.2

    const wheelMaterial = new THREE.MeshStandardMaterial({
      color: 0x111111,
      metalness: 0.1,
      roughness: 0.7,
    })

    const bodyGeometry = new THREE.BoxGeometry(1.6, 0.4, 3.6)
    bodyGeometry.translate(0, 0.4, 0)
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
    body.name = 'Body'
    group.add(body)

    const cabinGeometry = new THREE.BoxGeometry(1.1, 0.5, 1.6)
    cabinGeometry.translate(0, 0.9, -0.2)
    const cabin = new THREE.Mesh(cabinGeometry, cabinMaterial)
    cabin.name = 'Cabin'
    group.add(cabin)

    const spoilerGeometry = new THREE.BoxGeometry(1.4, 0.1, 0.8)
    spoilerGeometry.translate(0, 0.85, -1.5)
    const spoiler = new THREE.Mesh(spoilerGeometry, bodyMaterial.clone())
    spoiler.name = 'Spoiler'
    group.add(spoiler)

    const wheelGeometry = new THREE.CylinderGeometry(0.48, 0.48, 0.35, 16)
    wheelGeometry.rotateZ(Math.PI / 2)
    const wheelPositions: Array<[number, number, number]> = [
      [-0.85, 0.35, 1.3],
      [0.85, 0.35, 1.3],
      [-0.9, 0.35, -1.2],
      [0.9, 0.35, -1.2],
    ]

    wheelPositions.forEach(([x, y, z], index) => {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial)
      wheel.position.set(x, y, z)
      wheel.name = `Wheel_${index}`
      group.add(wheel)
    })

    return group
  }

  private tintMaterials(object: THREE.Object3D, color: THREE.Color): void {
    object.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((material) =>
            this.tintMaterial(material as THREE.Material, mesh.name, color),
          )
        } else {
          mesh.material = this.tintMaterial(mesh.material, mesh.name, color)
        }
      }
    })
  }

  private tintMaterial(
    source: THREE.Material,
    meshName: string,
    color: THREE.Color,
  ): THREE.Material {
    if (
      'color' in source &&
      source instanceof THREE.MeshStandardMaterial &&
      source.color instanceof THREE.Color
    ) {
      const material = source.clone() as StandardMaterial
      const targetColor = color as ColorWithChannels
      const shouldTint = this.shouldTintMaterial(meshName, material)
      const baseColor = material.color.clone()

      if (shouldTint) {
        const tintedMap = this.getTintedMap(material.map, targetColor)
        if (tintedMap) {
          material.map = tintedMap
        }
        // Blend toward player color; if no usable map, lean harder into the tint.
        const mix = tintedMap ? 0.55 : 0.9
        const tintedColor = baseColor.clone().lerp(targetColor, mix)
        material.color.copy(tintedColor)
      } else {
        material.color.copy(baseColor)
      }

      // Neon accent to read in the dark while keeping albedo/normal detail.
      const emissiveBase = shouldTint ? targetColor : material.color
      const emissiveColor = emissiveBase.clone().lerp(new THREE.Color(0x7cfbff), 0.35)
      material.emissive.copy(emissiveColor)
      material.emissiveIntensity = 0.1
      material.toneMapped = true
      material.needsUpdate = true
      return material
    }
    return source
  }

  private shouldTintMaterial(meshName: string, material: StandardMaterial): boolean {
    const meshLabel = meshName.toLowerCase()
    const materialLabel = (material.name || '').toLowerCase()
    const shouldSkipTint = UNTINTED_PART_KEYWORDS.some(
      (keyword) => meshLabel.includes(keyword) || materialLabel.includes(keyword),
    )
    if (shouldSkipTint) {
      return false
    }

    const isTransparentMaterial =
      material.transparent === true || material.opacity < 0.99 || !!material.alphaMap
    return !isTransparentMaterial
  }

  private getTintedMap(original: THREE.Texture | null, color: THREE.Color): THREE.Texture | null {
    const sourceTexture = original as TextureWithMetadata | null
    const targetColor = color as ColorWithChannels
    if (!sourceTexture || !sourceTexture.image) {
      return null
    }

    const cacheKey = `${sourceTexture.uuid}:${targetColor.getHexString()}`
    const cached = this.tintedTextureCache.get(cacheKey)
    if (cached) {
      return cached
    }

    const image = sourceTexture.image as TexImageSource
    const width = (image as { width?: number }).width
    const height = (image as { height?: number }).height
    if (
      typeof width !== 'number' ||
      typeof height !== 'number' ||
      width <= 0 ||
      height <= 0
    ) {
      return null
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      return null
    }

    context.drawImage(image as CanvasImageSource, 0, 0, width, height)
    const imageData = context.getImageData(0, 0, width, height)
    const data = imageData.data
    const r = targetColor.r
    const g = targetColor.g
    const b = targetColor.b

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3]
      if (alpha === 0) {
        continue
      }
      const luminance = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
      data[i] = Math.round(r * luminance)
      data[i + 1] = Math.round(g * luminance)
      data[i + 2] = Math.round(b * luminance)
    }

    context.putImageData(imageData, 0, 0)

    const tinted = new THREE.CanvasTexture(canvas) as TextureWithMetadata
    tinted.colorSpace = sourceTexture.colorSpace
    tinted.wrapS = sourceTexture.wrapS
    tinted.wrapT = sourceTexture.wrapT
    tinted.offset.copy(sourceTexture.offset)
    tinted.repeat.copy(sourceTexture.repeat)
    tinted.rotation = sourceTexture.rotation
    tinted.center.copy(sourceTexture.center)
    tinted.flipY = sourceTexture.flipY
    tinted.magFilter = sourceTexture.magFilter
    tinted.minFilter = sourceTexture.minFilter
    tinted.generateMipmaps = sourceTexture.generateMipmaps
    tinted.needsUpdate = true

    this.tintedTextureCache.set(cacheKey, tinted)
    return tinted
  }

  private logModelStructure(root: THREE.Object3D): void {
    const lines: string[] = []
    root.traverse((child: THREE.Object3D) => {
      const path = this.buildObjectPath(child)
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        const materialInfo = materials
          .map((material, index) => {
            const baseName = (material as { name?: string }).name
            const label = baseName && baseName.length > 0 ? baseName : `material-${index}`
            return `${label} (${material.type})`
          })
          .join(', ')
        lines.push(`${path} | materials: ${materialInfo}`)
      } else {
        lines.push(path)
      }
    })

    if (typeof console.groupCollapsed === 'function') {
      console.groupCollapsed('[CarModelLoader] Model structure')
      lines.forEach((line) => console.log(line))
      console.groupEnd()
    } else {
      lines.forEach((line) => console.log('[CarModelLoader]', line))
    }
  }

  private buildObjectPath(object: THREE.Object3D): string {
    const names: string[] = []
    let current: THREE.Object3D | null = object
    while (current) {
      names.push(current.name || current.type)
      current = current.parent as THREE.Object3D
    }
    return names.reverse().join(' > ')
  }
}
