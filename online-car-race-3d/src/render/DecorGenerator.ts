import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { TrackAssetDecoration, TrackData, TrackDecoration, TreeBeltDecoration } from '../core/trackTypes'
import { normalize, rightNormal, sub } from '../core/math2d'
import { resolveServerAssetUrl } from '../config'

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
    color: 0x112015,
    roughness: 1,
    metalness: 0,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  return mesh
}

class TreesDecorator implements Decorator<TreeBeltDecoration> {
  readonly type = 'tree-belt'

  apply(
    track: TrackData,
    instruction: TreeBeltDecoration,
    root: THREE.Object3D,
    random: () => number,
  ): void {
    const countPerSegment = Math.max(1, Math.round(instruction.density))
    const minDistanceFromTrack = instruction.minDistance
    const maxDistanceFromTrack = instruction.maxDistance

    const totalInstances = track.centerline.length * countPerSegment
    if (totalInstances === 0) {
      return
    }

    const geometry = new THREE.ConeGeometry(1, 4, 6)
    geometry.translate(0, 2, 0)

    const material = new THREE.MeshStandardMaterial({
      color: 0x1f4d1a,
      flatShading: true,
    })

    const mesh = new THREE.InstancedMesh(geometry, material, totalInstances)
    mesh.castShadow = true
    mesh.receiveShadow = true

    const dummy = new THREE.Object3D()
    let index = 0

    for (let i = 0; i < track.centerline.length; i++) {
      const curr = track.centerline[i]
      const next = track.centerline[(i + 1) % track.centerline.length]
      const dir = normalize(sub(next, curr))
      const normal = rightNormal(dir)

      for (let j = 0; j < countPerSegment; j++) {
        const side = random() > 0.5 ? 1 : -1
        const distance = THREE.MathUtils.lerp(
          minDistanceFromTrack,
          maxDistanceFromTrack,
          random(),
        )
        const offset = random() * 0.8
        const position = {
          x: curr.x + dir.x * offset * track.width + normal.x * distance * side,
          z: curr.z + dir.z * offset * track.width + normal.z * distance * side,
        }
        const scale = THREE.MathUtils.lerp(0.8, 1.8, random())
        const rotationY = random() * Math.PI * 2

        dummy.position.set(position.x, 0, position.z)
        dummy.scale.set(scale, scale, scale)
        dummy.rotation.set(0, rotationY, 0)
        dummy.updateMatrix()
        mesh.setMatrixAt(index, dummy.matrix)
        index++
      }
    }

    mesh.instanceMatrix.needsUpdate = true

    const group = new THREE.Group()
    group.name = 'decor-trees'
    group.add(mesh)
    root.add(group)
  }
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

  private loadBase(assetUrl: string): Promise<THREE.Object3D | null> {
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
    root.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })
    return root
  }
}

const trackAssetLoader = new TrackAssetLoader()

class TrackAssetDecorator implements Decorator<TrackAssetDecoration> {
  readonly type = 'track-asset'

  apply(
    _track: TrackData,
    instruction: TrackAssetDecoration,
    root: THREE.Object3D,
  ): void {
    const assetUrl = resolveServerAssetUrl(instruction.assetUrl)
    void trackAssetLoader.createInstance(assetUrl).then((instance) => {
      if (!instance) {
        return
      }
      const size = instruction.size > 0 ? instruction.size : 1
      instance.userData.isTrackAsset = true
      instance.name = `decor-asset-${instruction.assetUrl}`
      instance.position.set(instruction.position.x, 0, instruction.position.z)
      instance.rotation.y = instruction.rotation
      instance.scale.setScalar(size)
      root.add(instance)
    })
  }
}

type DecoratorRegistry = Record<TrackDecoration['type'], Decorator>

const decoratorRegistry: DecoratorRegistry = {
  'tree-belt': new TreesDecorator(),
  'track-asset': new TrackAssetDecorator(),
}

export function applyDecorators(
  track: TrackData,
  root: THREE.Object3D,
  random: () => number,
): void {
  const groundSize = Math.max(200, track.width * 100)
  const ground = createGroundPlane(groundSize)
  ground.position.y = -0.01
  root.add(ground)

  const decorations = track.decorations ?? []
  for (const decoration of decorations) {
    const decorator = decoratorRegistry[decoration.type]
    decorator.apply(track, decoration, root, random)
  }
}
