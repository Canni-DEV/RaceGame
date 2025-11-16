import * as THREE from 'three'
import type {
  StartBuildingDecoration,
  TrackData,
  TrackDecoration,
  TreeBeltDecoration,
} from '../core/trackTypes'
import { normalize, rightNormal, sub } from '../core/math2d'

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

class StartBuildingDecorator implements Decorator<StartBuildingDecoration> {
  readonly type = 'start-building'

  apply(
    _track: TrackData,
    instruction: StartBuildingDecoration,
    root: THREE.Object3D,
  ): void {
    const group = new THREE.Group()
    group.name = 'decor-start-building'
    group.position.set(instruction.position.x, 0, instruction.position.z)
    group.rotation.y = instruction.rotation

    const padGeometry = new THREE.BoxGeometry(
      instruction.length * 1.15,
      0.2,
      instruction.width * 1.8,
    )
    const padMaterial = new THREE.MeshStandardMaterial({
      color: 0x2f312f,
      roughness: 1,
      metalness: 0,
    })
    const pad = new THREE.Mesh(padGeometry, padMaterial)
    pad.position.y = -0.1
    pad.receiveShadow = true
    group.add(pad)

    const buildingGeometry = new THREE.BoxGeometry(
      instruction.length,
      instruction.height,
      instruction.width,
    )
    const buildingMaterial = new THREE.MeshStandardMaterial({
      color: 0x6f7687,
      roughness: 0.65,
      metalness: 0.15,
    })
    const building = new THREE.Mesh(buildingGeometry, buildingMaterial)
    building.position.y = instruction.height / 2
    building.castShadow = true
    building.receiveShadow = true
    group.add(building)

    const roofHeight = instruction.height * 0.2
    const roofGeometry = new THREE.BoxGeometry(
      instruction.length * 1.05,
      roofHeight,
      instruction.width * 1.05,
    )
    const roofMaterial = new THREE.MeshStandardMaterial({
      color: 0xc2b59b,
      roughness: 0.4,
      metalness: 0.05,
    })
    const roof = new THREE.Mesh(roofGeometry, roofMaterial)
    roof.position.y = instruction.height + roofHeight / 2
    roof.castShadow = true
    group.add(roof)

    const bannerGeometry = new THREE.PlaneGeometry(
      instruction.width,
      instruction.height * 0.5,
    )
    const bannerMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x121212,
      roughness: 0.3,
      metalness: 0,
    })
    const banner = new THREE.Mesh(bannerGeometry, bannerMaterial)
    banner.position.set(0, instruction.height * 0.8, instruction.width * 0.55)
    banner.castShadow = true
    group.add(banner)

    root.add(group)
  }
}

type DecoratorRegistry = Record<TrackDecoration['type'], Decorator>

const decoratorRegistry: DecoratorRegistry = {
  'tree-belt': new TreesDecorator(),
  'start-building': new StartBuildingDecorator(),
}

export function applyDecorators(
  track: TrackData,
  root: THREE.Object3D,
  random: () => number,
): void {
  const groundSize = Math.max(200, track.width * 20)
  const ground = createGroundPlane(groundSize)
  ground.position.y = -0.01
  root.add(ground)

  const decorations = track.decorations ?? []
  for (const decoration of decorations) {
    const decorator = decoratorRegistry[decoration.type]
    decorator.apply(track, decoration, root, random)
  }
}
