import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { InstancedDecoration, TrackData, TrackDecoration } from '../core/trackTypes'
import { resolveServerAssetUrl } from '../config'

const NEON_THEME = {
  groundColor: 0x060814,
  groundEmissive: 0x0b1433,
  groundRoughness: 0.65,
  groundMetalness: 0.15,
  gridStep: 18,
  gridOpacity: 0.2,
  palette: [0x00ffff, 0xff00ff, 0x7cfbff, 0x00f7a5],
  accent: 0xff5df2,
  emissiveIntensity: 0.35,
}

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

export function createGroundPlane(size: number): THREE.Group {
  const geometry = new THREE.PlaneGeometry(size, size)
  geometry.rotateX(-Math.PI / 2)

  const material = new THREE.MeshStandardMaterial({
    color: NEON_THEME.groundColor,
    roughness: NEON_THEME.groundRoughness,
    metalness: NEON_THEME.groundMetalness,
    emissive: new THREE.Color(NEON_THEME.groundEmissive),
    emissiveIntensity: 0.55,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = false
  mesh.name = 'cyber-ground'

  const group = new THREE.Group()
  group.add(mesh)

  const grid = createNeonGrid(size)
  group.add(grid)

  return group
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
    random: () => number,
  ): void {
    if (instruction.mesh === 'procedural-tree') {
      const treeGroup = this.buildTreeInstances(instruction.instances, random)
      if (treeGroup) {
        root.add(treeGroup)
      }
      return
    }

    if (!instruction.assetUrl) {
      return
    }

    const assetUrl = resolveServerAssetUrl(instruction.assetUrl)
    void this.buildAssetInstances(assetUrl, instruction.instances, root, random)
  }

  private async buildAssetInstances(
    assetUrl: string,
    instances: InstancedDecoration['instances'],
    root: THREE.Object3D,
    random: () => number,
  ): Promise<void> {
    const base = await trackAssetLoader.loadBase(assetUrl)
    if (!base) {
      return
    }

    base.updateMatrixWorld(true)
    applyNeonStyle(base, random)

    const templateMeshes: THREE.Mesh[] = []
    base.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        // InstancedMesh does not support skinned meshes; fall back to cloning in that case.
        if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
          templateMeshes.length = 0
        }
        templateMeshes.push(mesh)
      }
    })

    if (templateMeshes.length === 0 || (templateMeshes[0] as THREE.SkinnedMesh).isSkinnedMesh) {
      for (const [index, instance] of instances.entries()) {
        const clone = SkeletonUtils.clone(base) as THREE.Object3D
        clone.userData.isTrackAsset = true
        clone.name = `decor-asset-${assetUrl}-${index}`
        clone.position.set(instance.position.x, 0, instance.position.z)
        clone.rotation.y = toRendererYaw(instance.rotation)
        clone.scale.setScalar(instance.scale)
        root.add(clone)
      }
      return
    }

    const decorationGroup = new THREE.Group()
    decorationGroup.name = `decor-instanced-asset-${assetUrl}`

    const instanceTransform = new THREE.Object3D()
    const reusableMatrix = new THREE.Matrix4()

    const uniqueTemplates = new Map<THREE.BufferGeometry, THREE.Mesh>()
    for (const mesh of templateMeshes) {
      const geometry = mesh.geometry
      if (!uniqueTemplates.has(geometry)) {
        uniqueTemplates.set(geometry, mesh)
      }
    }

    uniqueTemplates.forEach((mesh, geometry) => {
      const mergedGeometry = mergeGeometries([geometry], false) ?? geometry
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      if (!material) {
        return
      }
      const instancedMesh = new THREE.InstancedMesh(mergedGeometry, material, instances.length)
      instancedMesh.castShadow = mesh.castShadow
      instancedMesh.receiveShadow = mesh.receiveShadow
      instancedMesh.name = `${mesh.name || 'decor-submesh'}-instanced`

      const meshMatrix = mesh.matrixWorld.clone()
      instances.forEach((instance, index) => {
        instanceTransform.position.set(instance.position.x, 0, instance.position.z)
        instanceTransform.rotation.set(0, toRendererYaw(instance.rotation), 0)
        instanceTransform.scale.setScalar(instance.scale)
        instanceTransform.updateMatrix()

        reusableMatrix.multiplyMatrices(instanceTransform.matrix, meshMatrix)
        instancedMesh.setMatrixAt(index, reusableMatrix)
      })
      instancedMesh.instanceMatrix.needsUpdate = true

      decorationGroup.add(instancedMesh)
    })

    decorationGroup.userData.isTrackAsset = true
    root.add(decorationGroup)
  }

  private buildTreeInstances(
    instances: InstancedDecoration['instances'],
    random: () => number,
  ): THREE.Object3D | null {
    if (instances.length === 0) {
      return null
    }
    const geometry = new THREE.ConeGeometry(1, 4.2, 6)
    geometry.translate(0, 2.1, 0)
    const neonColor = pickNeonColor(random)
    const material = new THREE.MeshStandardMaterial({
      color: neonColor,
      emissive: new THREE.Color(neonColor),
      emissiveIntensity: NEON_THEME.emissiveIntensity * 0.6,
      flatShading: true,
      metalness: 0.2,
      roughness: 0.35,
    })

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

function createNeonGrid(size: number): THREE.LineSegments {
  const half = size / 2
  const step = NEON_THEME.gridStep
  const positions: number[] = []
  const colors: number[] = []
  let colorIndex = 0

  const palette = NEON_THEME.palette
  for (let x = -half; x <= half; x += step) {
    positions.push(x, 0, -half, x, 0, half)
    const color = new THREE.Color(palette[colorIndex % palette.length])
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b)
    colorIndex++
  }
  for (let z = -half; z <= half; z += step) {
    positions.push(-half, 0, z, half, 0, z)
    const color = new THREE.Color(palette[colorIndex % palette.length])
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b)
    colorIndex++
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: NEON_THEME.gridOpacity,
    blending: THREE.AdditiveBlending,
    linewidth: 1,
    toneMapped: false,
  })

  const lines = new THREE.LineSegments(geometry, material)
  lines.position.y = 0.02
  lines.name = 'neon-grid'
  lines.userData.isTrackAsset = true
  return lines
}

function applyNeonStyle(object: THREE.Object3D, random: () => number): void {
  object.traverse((child: THREE.Object3D) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((material) => tintMaterial(material, pickNeonColor(random)))
      } else {
        mesh.material = tintMaterial(mesh.material, pickNeonColor(random))
      }
    }
  })
}

function tintMaterial(material: THREE.Material, neon: number): THREE.Material {
  if (
    'color' in material &&
    material instanceof THREE.MeshStandardMaterial &&
    material.color instanceof THREE.Color
  ) {
    const clone = material.clone()
    const emissiveColor = new THREE.Color(neon)
    clone.emissive = emissiveColor
    clone.emissiveIntensity = NEON_THEME.emissiveIntensity
    clone.metalness = Math.max(clone.metalness, 0.25)
    clone.roughness = Math.min(clone.roughness, 0.35)
    return clone
  }
  return material
}

function pickNeonColor(random: () => number): number {
  const index = Math.floor(random() * NEON_THEME.palette.length)
  return NEON_THEME.palette[index]
}
