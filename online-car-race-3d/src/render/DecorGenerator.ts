import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { InstancedDecoration, TrackData, TrackDecoration } from '../core/trackTypes'
import { resolvePublicAssetUrl, resolveServerAssetUrl } from '../config'

interface Decorator<TInstruction extends TrackDecoration = TrackDecoration> {
  readonly type: TInstruction['type']
  apply(
    track: TrackData,
    instruction: TInstruction,
    root: THREE.Object3D,
    random: () => number,
  ): void
}

const BAR_SCENE_MODEL_PATH = 'models/BarScene.glb'

// Ajusta estas transformaciones para alinear el track con la mesa de la escena.
export const BAR_SCENE_TRANSFORM = {
  scale: 200,
  positionOffset: new THREE.Vector3(-825, -466, -995),
  rotationY: 0,
}

const GROUND_SIZE = 600
const GROUND_WORLD_OFFSET = new THREE.Vector3(0, -0.01, 0)

// Plano de suelo reutilizable, se ancla al modelo del bar para mantenerse alineado con la mesa
let barGroundPlane: THREE.Mesh | null = null

export function createGroundPlane(size: number): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(size, size)
  geometry.rotateX(-Math.PI / 2)

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  return mesh
}

function ensureBarGroundPlane(): THREE.Mesh {
  if (!barGroundPlane) {
    barGroundPlane = createGroundPlane(GROUND_SIZE)
    barGroundPlane.name = 'decor-ground-plane'
  }
  return barGroundPlane
}

function attachGroundPlaneToBarScene(trackCenter: THREE.Vector3, barScene: THREE.Object3D): void {
  const ground = ensureBarGroundPlane()
  ground.removeFromParent()

  const targetWorld = trackCenter.clone().add(GROUND_WORLD_OFFSET)
  const scale = BAR_SCENE_TRANSFORM.scale
  const localX = (targetWorld.x - barScene.position.x + 20) / scale
  const localY = (targetWorld.y - barScene.position.y) / scale
  const localZ = (targetWorld.z - barScene.position.z - 10) / scale

  ground.position.set(localX, localY, localZ)
  ground.scale.setScalar(1 / scale)
  barScene.add(ground)
}

const barSceneUrl = resolvePublicAssetUrl(BAR_SCENE_MODEL_PATH)
const barSceneLoader = new GLTFLoader()
let barSceneBase: Promise<THREE.Object3D | null> | null = null

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

async function loadBarScene(): Promise<THREE.Object3D | null> {
  if (!barSceneBase) {
    barSceneBase = barSceneLoader
      .loadAsync(barSceneUrl)
      .then((gltf: GLTF) => prepareBarScene(gltf.scene))
      .catch((error: unknown) => {
        console.warn(`[DecorGenerator] Failed to load bar scene from "${barSceneUrl}"`, error)
        return null
      })
  }
  return barSceneBase
}

function prepareBarScene(scene: THREE.Object3D): THREE.Object3D {
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

function computeTrackCenter(track: TrackData): THREE.Vector3 {
  if (!track.centerline.length) {
    return new THREE.Vector3()
  }
  let minX = track.centerline[0]!.x
  let maxX = minX
  let minZ = track.centerline[0]!.z
  let maxZ = minZ

  for (let i = 1; i < track.centerline.length; i++) {
    const point = track.centerline[i]!
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minZ = Math.min(minZ, point.z)
    maxZ = Math.max(maxZ, point.z)
  }

  return new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2)
}

function addBarSceneEnvironment(track: TrackData, root: THREE.Object3D): void {
  const trackCenter = computeTrackCenter(track)
  void loadBarScene().then((base) => {
    if (!base) {
      return
    }
    const instance = SkeletonUtils.clone(base) as THREE.Object3D
    instance.name = 'bar-scene-environment'
    instance.userData.isTrackAsset = true
    instance.position.copy(trackCenter).add(BAR_SCENE_TRANSFORM.positionOffset)
    instance.rotation.y = BAR_SCENE_TRANSFORM.rotationY
    instance.scale.setScalar(BAR_SCENE_TRANSFORM.scale)
    attachGroundPlaneToBarScene(trackCenter, instance)
    root.add(instance)
  })
}

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
      clone.rotation.y = instance.rotation
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
      dummy.rotation.set(0, instance.rotation, 0)
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
  addBarSceneEnvironment(track, root)
  const decorations = track.decorations ?? []
  for (const decoration of decorations) {
    const decorator = decoratorRegistry[decoration.type]
    decorator.apply(track, decoration, root, random)
  }
}
