import * as THREE from 'three'
import type { TrackData } from '../core/trackTypes'
import type { TrackBuildResult } from './TrackMeshBuilder'

interface InstanceTransform {
  position: THREE.Vector3
  rotationY: number
  scale: THREE.Vector3
}

export function applyDecorators(
  track: TrackData,
  buildResult: TrackBuildResult,
  root: THREE.Object3D,
  random: () => number,
): void {
  void track
  const decorator = new NeonDecorator(random)
  decorator.populate(track, buildResult, root)
}

class NeonDecorator {
  private readonly random: () => number

  constructor(random: () => number) {
    this.random = random
  }

  populate(_track: TrackData, buildResult: TrackBuildResult, root: THREE.Object3D): void {
    void _track
    const monolithTransforms = this.generateMonoliths(buildResult)
    const monoliths = this.buildMonolithInstances(monolithTransforms)
    const wireframes = this.buildWireframeInstances(monolithTransforms)
    const artifacts = this.buildFloatingArtifacts(buildResult)

    if (monoliths) {
      root.add(monoliths)
    }
    if (wireframes) {
      root.add(wireframes)
    }
    if (artifacts) {
      root.add(artifacts)
    }
  }

  private generateMonoliths(buildResult: TrackBuildResult): InstanceTransform[] {
    const transforms: InstanceTransform[] = []
    const { leftEdge, rightEdge, normals } = buildResult

    const createTransform = (edge: THREE.Vector3, normal: THREE.Vector3) => {
      const height = THREE.MathUtils.lerp(5, 20, this.random())
      const baseScale = THREE.MathUtils.lerp(0.6, 1.4, this.random())
      const rotation = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(-12, 12, this.random()))
      const offset = THREE.MathUtils.lerp(0.8, 2.2, this.random())
      const position = edge.clone().addScaledVector(normal, offset)
      position.y = height * 0.5

      transforms.push({
        position,
        rotationY: rotation,
        scale: new THREE.Vector3(baseScale, height, baseScale),
      })
    }

    const step = Math.max(1, Math.floor(leftEdge.length / 180))
    for (let i = 0; i < leftEdge.length; i += step) {
      if (this.random() < 0.35) {
        continue
      }
      const left = leftEdge[i]
      const right = rightEdge[i]
      const normal = normals[i]

      const leftPosition = new THREE.Vector3(left.x, 0, left.z)
      const leftNormal = new THREE.Vector3(-normal.x, 0, -normal.z).normalize()
      createTransform(leftPosition, leftNormal)

      if (this.random() > 0.25) {
        const rightPosition = new THREE.Vector3(right.x, 0, right.z)
        const rightNormal = new THREE.Vector3(normal.x, 0, normal.z).normalize()
        createTransform(rightPosition, rightNormal)
      }
    }

    return transforms
  }

  private buildMonolithInstances(transforms: InstanceTransform[]): THREE.InstancedMesh | null {
    if (transforms.length === 0) {
      return null
    }

    const geometry = new THREE.BoxGeometry(1, 1, 1)
    geometry.translate(0, 0.5, 0)
    const material = new THREE.MeshStandardMaterial({
      color: 0x0b0d18,
      roughness: 0.9,
      metalness: 0.08,
    })

    const mesh = new THREE.InstancedMesh(geometry, material, transforms.length)
    mesh.name = 'decor-monoliths'
    mesh.castShadow = false
    mesh.receiveShadow = false

    const dummy = new THREE.Object3D()
    transforms.forEach((transform, index) => {
      dummy.position.copy(transform.position)
      dummy.rotation.set(0, transform.rotationY, 0)
      dummy.scale.copy(transform.scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true

    return mesh
  }

  private buildWireframeInstances(transforms: InstanceTransform[]): THREE.InstancedMesh | null {
    if (transforms.length === 0) {
      return null
    }

    const geometry = new THREE.BoxGeometry(1.01, 1.01, 1.01)
    geometry.translate(0, 0.5, 0)
    const material = new THREE.MeshBasicMaterial({
      color: 0xff00ff,
      wireframe: true,
      transparent: true,
      opacity: 0.65,
      toneMapped: true,
      depthWrite: false,
    })

    const mesh = new THREE.InstancedMesh(geometry, material, transforms.length)
    mesh.name = 'decor-monolith-wires'

    const dummy = new THREE.Object3D()
    transforms.forEach((transform, index) => {
      dummy.position.copy(transform.position)
      dummy.rotation.set(0, transform.rotationY, 0)
      dummy.scale.copy(transform.scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true

    return mesh
  }

  private buildFloatingArtifacts(buildResult: TrackBuildResult): THREE.Group | null {
    const totalArtifacts = Math.max(12, Math.floor(buildResult.centerline.length / 8))
    if (totalArtifacts === 0) {
      return null
    }

    const torusGeometry = new THREE.TorusGeometry(1.2, 0.24, 8, 32)
    const icoGeometry = new THREE.IcosahedronGeometry(1.2, 0)
    const material = new THREE.MeshStandardMaterial({
      color: 0x021226,
      emissive: 0x00ffff,
      emissiveIntensity: 2,
      roughness: 0.35,
      metalness: 0.4,
    })

    const torusMesh = new THREE.InstancedMesh(torusGeometry, material, Math.ceil(totalArtifacts / 2))
    const icoMesh = new THREE.InstancedMesh(icoGeometry, material, Math.floor(totalArtifacts / 2))
    torusMesh.name = 'decor-floating-torus'
    icoMesh.name = 'decor-floating-icosa'

    const dummy = new THREE.Object3D()
    const placeInstance = (mesh: THREE.InstancedMesh, index: number) => {
      const sampleIndex = Math.floor(this.random() * buildResult.centerline.length)
      const base = buildResult.centerline[sampleIndex]
      const normal = buildResult.normals[sampleIndex]
      const offset = THREE.MathUtils.lerp(-4, 4, this.random())
      const height = THREE.MathUtils.lerp(6, 16, this.random())
      const rotation = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(-180, 180, this.random()))

      dummy.position.set(base.x + normal.x * offset, height, base.z + normal.z * offset)
      dummy.rotation.set(this.random() * Math.PI, rotation, this.random() * Math.PI)
      const scale = THREE.MathUtils.lerp(0.8, 1.6, this.random())
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
    }

    for (let i = 0; i < torusMesh.count; i++) {
      placeInstance(torusMesh, i)
    }
    for (let i = 0; i < icoMesh.count; i++) {
      placeInstance(icoMesh, i)
    }
    torusMesh.instanceMatrix.needsUpdate = true
    icoMesh.instanceMatrix.needsUpdate = true

    const group = new THREE.Group()
    group.add(torusMesh, icoMesh)
    return group
  }
}
