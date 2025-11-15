import * as THREE from 'three'
import type { TrackData } from '../core/trackTypes'
import { normalize, rightNormal, sub } from '../core/math2d'

export interface ProceduralDecorator {
  id: string
  apply(track: TrackData, scene: THREE.Scene, random: () => number): void
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

class TreesDecorator implements ProceduralDecorator {
  readonly id = 'trees'

  apply(track: TrackData, scene: THREE.Scene, random: () => number): void {
    const countPerSegment = 6
    const minDistanceFromTrack = track.width * 0.7
    const maxDistanceFromTrack = track.width * 2.5

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
    scene.add(group)
  }
}

export function applyDecorators(
  track: TrackData,
  scene: THREE.Scene,
  random: () => number,
): void {
  const groundSize = Math.max(200, track.width * 20)
  const ground = createGroundPlane(groundSize)
  ground.position.y = -0.01
  scene.add(ground)

  const decorators: ProceduralDecorator[] = [new TreesDecorator()]

  for (const decorator of decorators) {
    decorator.apply(track, scene, random)
  }
}
