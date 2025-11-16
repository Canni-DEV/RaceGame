import * as THREE from 'three'
import type { CarState } from '../core/trackTypes'
import { CarModelLoader } from './CarModelLoader'

const TEMP_VECTOR = new THREE.Vector3()
const TEMP_VECTOR_2 = new THREE.Vector3()
const TEMP_VECTOR_3 = new THREE.Vector3()
const UP_AXIS = new THREE.Vector3(0, 1, 0)

export class CarEntity {
  readonly id: string
  private readonly scene: THREE.Scene
  private readonly loader: CarModelLoader
  private readonly color: THREE.Color
  private object: THREE.Object3D | null = null
  private readonly currentPosition = new THREE.Vector3()
  private readonly targetPosition = new THREE.Vector3()
  private readonly orientation = new THREE.Quaternion()
  private readonly targetOrientation = new THREE.Quaternion()
  private readonly desiredForward = new THREE.Vector3(0, 0, 1)
  private readonly lastServerPosition = new THREE.Vector3()
  private hasReceivedState = false
  private disposed = false

  constructor(id: string, scene: THREE.Scene, loader: CarModelLoader, color: THREE.Color) {
    this.id = id
    this.scene = scene
    this.loader = loader
    this.color = color
    void this.spawn()
  }

  private async spawn(): Promise<void> {
    if (this.disposed) {
      return
    }
    const object = await this.loader.createInstance(this.color)
    if (this.disposed) {
      object.traverse((child: THREE.Object3D) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh
          mesh.geometry.dispose()
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((material) => material.dispose())
          } else {
            mesh.material.dispose()
          }
        }
      })
      return
    }
    object.position.copy(this.currentPosition)
    object.quaternion.copy(this.orientation)
    this.scene.add(object)
    this.object = object
  }

  setTargetState(state: CarState): void {
    this.targetPosition.set(state.x, 0, state.z)
    if (!this.hasReceivedState) {
      this.currentPosition.copy(this.targetPosition)
      this.lastServerPosition.copy(this.targetPosition)
      this.hasReceivedState = true
    }

    const displacement = TEMP_VECTOR.subVectors(this.targetPosition, this.lastServerPosition)
    this.lastServerPosition.copy(this.targetPosition)
    const displacementLengthSq = displacement.lengthSq()

    const forwardFromAngle = TEMP_VECTOR_2.set(Math.sin(state.angle), 0, Math.cos(state.angle))
    const velocityForward = TEMP_VECTOR_3.copy(forwardFromAngle).multiplyScalar(state.speed)
    const velocityLengthSq = velocityForward.lengthSq()

    if (velocityLengthSq > 0.0001) {
      this.desiredForward.copy(velocityForward).normalize()
    } else if (displacementLengthSq > 0.0001) {
      this.desiredForward.copy(displacement).normalize()
    } else {
      this.desiredForward.copy(forwardFromAngle)
    }

    const yaw = Math.atan2(this.desiredForward.x, this.desiredForward.z)
    this.targetOrientation.setFromAxisAngle(UP_AXIS, yaw)
  }

  update(dt: number): void {
    if (!this.hasReceivedState) {
      return
    }
    const positionLerp = 1 - Math.exp(-dt * 7)
    this.currentPosition.lerp(this.targetPosition, positionLerp)

    const rotationLerp = 1 - Math.exp(-dt * 8)
    this.orientation.slerp(this.targetOrientation, rotationLerp)

    if (this.object) {
      this.object.position.copy(this.currentPosition)
      this.object.quaternion.copy(this.orientation)
    }
  }

  getObject(): THREE.Object3D | null {
    return this.object
  }

  dispose(): void {
    this.disposed = true
    if (this.object) {
      this.object.removeFromParent()
      this.object.traverse((child: THREE.Object3D) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh
          mesh.geometry.dispose()
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((material) => material.dispose())
          } else {
            mesh.material.dispose()
          }
        }
      })
      this.object = null
    }
  }
}
