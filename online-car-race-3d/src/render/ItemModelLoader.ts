import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import { resolveServerAssetUrl } from '../config'
import type { ItemType } from '../core/trackTypes'

const MODEL_PATHS: Record<ItemType, string> = {
  nitro: '/assets/nitro.glb',
  shoot: '/assets/shoot.glb',
}

const FALLBACK_COLORS: Record<ItemType, number> = {
  nitro: 0x4ad1ff,
  shoot: 0xff6b4a,
}

export class ItemModelLoader {
  private readonly loader = new GLTFLoader()
  private readonly cache = new Map<ItemType, Promise<THREE.Object3D>>()

  async createInstance(type: ItemType): Promise<THREE.Object3D> {
    const base = await this.loadModel(type)
    return SkeletonUtils.clone(base) as THREE.Object3D
  }

  private loadModel(type: ItemType): Promise<THREE.Object3D> {
    const cached = this.cache.get(type)
    if (cached) {
      return cached
    }

    const modelPath = resolveServerAssetUrl(MODEL_PATHS[type])
    const promise = this.loader
      .loadAsync(modelPath)
      .then((gltf: GLTF) => this.prepareModel(gltf.scene))
      .catch((error: unknown) => {
        console.warn(`[ItemModelLoader] Failed to load ${type} model from "${modelPath}"`, error)
        return this.buildFallback(type)
      })

    this.cache.set(type, promise)
    return promise
  }

  private prepareModel(model: THREE.Object3D): THREE.Object3D {
    const root = model.clone()
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

    return root
  }

  private buildFallback(type: ItemType): THREE.Object3D {
    const color = FALLBACK_COLORS[type] ?? 0xffffff
    const group = new THREE.Group()
    group.name = `${type}-fallback`

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color,
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.2,
      roughness: 0.35,
      metalness: 0.15,
    })
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.1,
      roughness: 0.4,
      metalness: 0.2,
    })

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.9, 16), bodyMaterial)
    body.name = `${type}-body`
    group.add(body)

    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.2, 0.45), accentMaterial)
    cap.position.y = 0.55
    cap.name = `${type}-cap`
    group.add(cap)

    return group
  }
}
