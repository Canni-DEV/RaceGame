import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { InstancedDecoration, TrackData, TrackDecoration } from '../core/trackTypes'
import { resolveServerAssetUrl } from '../config'

// Backend rotations use the game angle convention (0 = +X). Three.js yaw expects 0 = +Z,
// so we convert to the same mapping cars/missiles use.
function toRendererYaw(angle: number): number {
  return Math.atan2(Math.cos(angle), Math.sin(angle))
}

interface Decorator<TInstruction extends TrackDecoration = TrackDecoration> {
  readonly type: TInstruction['type']
  apply(
    track: TrackData,
    instruction: TInstruction,
    root: THREE.Object3D,
    random: () => number,
  ): void
}

export function createGroundPlane(size: number): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(size, size)
  geometry.rotateX(-Math.PI / 2)

  const material = new THREE.MeshStandardMaterial({
    color: 0x1a2b1f,
    roughness: 1,
    metalness: 0,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  return mesh
}

class TrackAssetLoader {
  private readonly loader = new GLTFLoader()
  private readonly cache = new Map<string, Promise<THREE.Object3D | null>>()

  async createInstance(assetUrl: string): Promise<THREE.Object3D | null> {
    const base = await this.loadBase(assetUrl)
    if (!base) {
      return null
    }
    return SkeletonUtils.clone(base) as THREE.Object3D
  }

  async loadBase(assetUrl: string): Promise<THREE.Object3D | null> {
    if (!this.cache.has(assetUrl)) {
      const promise = this.loader
        .loadAsync(assetUrl)
        .then((gltf: GLTF) => this.prepareModel(gltf.scene))
        .catch((error: unknown) => {
          console.warn(`[TrackAssetLoader] Failed to load asset "${assetUrl}"`, error)
          return null
        })
      this.cache.set(assetUrl, promise)
    }
    return this.cache.get(assetUrl) as Promise<THREE.Object3D | null>
  }

  private prepareModel(scene: THREE.Object3D): THREE.Object3D {
    const root = scene.clone()
    root.updateMatrixWorld(true)

    const bounds = new THREE.Box3().setFromObject(root)
    const pivot = new THREE.Group()
    pivot.name = 'decor-asset-pivot'

    const recenter = bounds.getCenter(new THREE.Vector3())
    recenter.y = bounds.min.y
    root.position.sub(recenter)
    root.updateMatrixWorld(true)

    pivot.add(root)

    pivot.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })
    return pivot
  }
}

const trackAssetLoader = new TrackAssetLoader()

class InstancedDecorationDecorator implements Decorator<InstancedDecoration> {
  readonly type = 'instanced-decoration'

  apply(
    _track: TrackData,
    instruction: InstancedDecoration,
    root: THREE.Object3D,
    _random: () => number,
  ): void {
    if (instruction.mesh === 'procedural-tree') {
      const treeGroup = this.buildTreeInstances(instruction.instances)
      if (treeGroup) {
        root.add(treeGroup)
      }
      return
    }

    if (!instruction.assetUrl) {
      return
    }

    const assetUrl = resolveServerAssetUrl(instruction.assetUrl)
    void this.buildAssetInstances(assetUrl, instruction.instances, root)
  }

  private async buildAssetInstances(
    assetUrl: string,
    instances: InstancedDecoration['instances'],
    root: THREE.Object3D,
  ): Promise<void> {
    const base = await trackAssetLoader.loadBase(assetUrl)
    if (!base) {
      return
    }

    for (const [index, instance] of instances.entries()) {
      const clone = SkeletonUtils.clone(base) as THREE.Object3D
      clone.userData.isTrackAsset = true
      clone.name = `decor-asset-${assetUrl}-${index}`
      clone.position.set(instance.position.x, 0, instance.position.z)
      clone.rotation.y = toRendererYaw(instance.rotation)
      clone.scale.setScalar(instance.scale)
      root.add(clone)
    }
  }

  private buildTreeInstances(instances: InstancedDecoration['instances']): THREE.Object3D | null {
    if (instances.length === 0) {
      return null
    }
    const geometry = new THREE.ConeGeometry(1, 4.2, 6)
    geometry.translate(0, 2.1, 0)
    const material = new THREE.MeshStandardMaterial({ color: 0x1f4d1a, flatShading: true })

    const mesh = new THREE.InstancedMesh(geometry, material, instances.length)
    mesh.castShadow = true
    mesh.receiveShadow = true

    const dummy = new THREE.Object3D()
    instances.forEach((instance, index) => {
      dummy.position.set(instance.position.x, 0, instance.position.z)
      dummy.rotation.set(0, toRendererYaw(instance.rotation), 0)
      dummy.scale.setScalar(instance.scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true

    const group = new THREE.Group()
    group.name = 'decor-instanced-tree'
    group.add(mesh)
    return group
  }
}

type DecoratorRegistry = Record<TrackDecoration['type'], Decorator>

const decoratorRegistry: DecoratorRegistry = {
  'instanced-decoration': new InstancedDecorationDecorator(),
}

export function applyDecorators(
  track: TrackData,
  root: THREE.Object3D,
  random: () => number,
): void {
  const groundSize = Math.max(200, track.width * 200)
  const ground = createGroundPlane(groundSize)
  ground.position.y = -0.01
  root.add(ground)

  const decorations = track.decorations ?? []
  for (const decoration of decorations) {
    const decorator = decoratorRegistry[decoration.type]
    decorator.apply(track, decoration, root, random)
  }
}
