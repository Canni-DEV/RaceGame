import * as THREE from 'three'
import type { InstancedDecoration, TrackData, TrackDecoration } from '../core/trackTypes'

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

class InstancedDecorationDecorator implements Decorator<InstancedDecoration> {
  readonly type = 'instanced-decoration'

  apply(
    _track: TrackData,
    instruction: InstancedDecoration,
    root: THREE.Object3D,
    random: () => number,
  ): void {
    if (instruction.instances.length === 0) {
      return
    }

    const clusters = instruction.instances.map((instance) =>
      this.buildCluster(instance.position, instance.rotation, random),
    )

    const totalMonoliths = clusters.reduce((sum, cluster) => sum + cluster.monoliths.length, 0)
    if (totalMonoliths === 0) {
      return
    }

    const monolithMesh = this.buildMonoliths(totalMonoliths, clusters)

    const group = new THREE.Group()
    group.name = 'decor-cyberpunk-cluster'
    group.add(monolithMesh)

    root.add(group)
  }

  private buildCluster(position: { x: number; z: number }, angle: number, random: () => number) {
    const clusterSize = 3 + Math.floor(random() * 3)
    const monoliths: THREE.Matrix4[] = []
    const rotation = toRendererYaw(angle)

    for (let i = 0; i < clusterSize; i++) {
      const offsetRadius = THREE.MathUtils.lerp(2.5, 9.5, random())
      const offsetTheta = random() * Math.PI * 2
      const offsetX = Math.cos(offsetTheta) * offsetRadius
      const offsetZ = Math.sin(offsetTheta) * offsetRadius

      const scaleY = THREE.MathUtils.lerp(15, 50, random())
      const scaleX = THREE.MathUtils.lerp(3, 8, random())
      const scaleZ = THREE.MathUtils.lerp(3, 8, random())

      const dummy = new THREE.Object3D()
      dummy.position.set(
        position.x + offsetX,
        scaleY * 0.5,
        position.z + offsetZ,
      )
      dummy.rotation.set(0, rotation + random() * Math.PI * 2, 0)
      dummy.scale.set(scaleX, scaleY, scaleZ)
      dummy.updateMatrix()
      monoliths.push(dummy.matrix.clone())
    }

    return { monoliths }
  }

  private buildMonoliths(total: number, clusters: ReturnType<typeof this.buildCluster>[]): THREE.InstancedMesh {
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const material = new THREE.MeshStandardMaterial({
      color: 0x0a0a14,
      emissive: 0x1b1b44,
      emissiveIntensity: 1.6,
      roughness: 0.74,
      metalness: 0.22,
    })

    const mesh = new THREE.InstancedMesh(geometry, material, total)
    const dummy = new THREE.Object3D()
    let index = 0
    for (const cluster of clusters) {
      for (const matrix of cluster.monoliths) {
        dummy.matrix.copy(matrix)
        mesh.setMatrixAt(index++, dummy.matrix)
      }
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.castShadow = false
    mesh.receiveShadow = true
    return mesh
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
  const decorations = track.decorations ?? []
  for (const decoration of decorations) {
    const decorator = decoratorRegistry[decoration.type]
    decorator.apply(track, decoration, root, random)
  }
}
