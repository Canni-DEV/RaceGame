import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import { resolvePublicAssetUrl } from '../config'

const DEFAULT_MODEL_PATH = 'models/car.glb'
const TARGET_LENGTH = 4.6

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
    if ('color' in source && source instanceof THREE.MeshStandardMaterial) {
      const material = source.clone()
      if (!meshName.toLowerCase().includes('wheel')) {
        material.color.lerp(color, 0.7)
      }
      material.needsUpdate = true
      return material
    }
    return source
  }
}
