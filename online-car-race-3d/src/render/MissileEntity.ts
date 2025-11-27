import * as THREE from 'three'
import type { MissileState } from '../core/trackTypes'
import { TRACK_SURFACE_HEIGHT } from './TrackMeshBuilder'

const HEIGHT_OFFSET = TRACK_SURFACE_HEIGHT + 0.9
const POSITION_SMOOTHING = 12
const ROTATION_SMOOTHING = 16

export class MissileEntity {
  readonly id: string
  private readonly scene: THREE.Scene
  private readonly color: THREE.Color
  private object: THREE.Mesh | null = null
  private readonly currentPosition = new THREE.Vector3(0, HEIGHT_OFFSET, 0)
  private readonly targetPosition = new THREE.Vector3(0, HEIGHT_OFFSET, 0)
  private readonly orientation = new THREE.Quaternion()
  private readonly targetOrientation = new THREE.Quaternion()
  private hasReceivedState = false

  private static geometry = new THREE.BoxGeometry(0.35, 0.35, 1.4)
  private static baseMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissiveIntensity: 0.75,
    roughness: 0.4,
    metalness: 0.25,
  })

  constructor(id: string, scene: THREE.Scene, color: THREE.Color) {
    this.id = id
    this.scene = scene
    this.color = color
    this.spawn()
  }

  private spawn(): void {
    const standardMaterial = MissileEntity.baseMaterial.clone() as THREE.MeshStandardMaterial
    standardMaterial.color = this.color.clone()
    const mesh = new THREE.Mesh(MissileEntity.geometry, standardMaterial)
    mesh.castShadow = true
    mesh.receiveShadow = false
    mesh.position.copy(this.currentPosition)
    mesh.quaternion.copy(this.orientation)
    this.scene.add(mesh)
    this.object = mesh
  }

  setTargetState(state: MissileState): void {
    this.targetPosition.set(state.x, HEIGHT_OFFSET, state.z)
    const forwardX = Math.cos(state.angle)
    const forwardZ = Math.sin(state.angle)
    const yaw = Math.atan2(forwardX, forwardZ)
    if (!this.hasReceivedState) {
      this.currentPosition.copy(this.targetPosition)
      this.orientation.setFromEuler(new THREE.Euler(0, yaw, 0))
      this.hasReceivedState = true
    }
    this.targetOrientation.setFromEuler(new THREE.Euler(0, yaw, 0))
  }

  update(dt: number): void {
    if (!this.hasReceivedState) {
      return
    }

    const positionAlpha = 1 - Math.exp(-dt * POSITION_SMOOTHING)
    this.currentPosition.lerp(this.targetPosition, positionAlpha)

    const rotationAlpha = 1 - Math.exp(-dt * ROTATION_SMOOTHING)
    this.orientation.slerp(this.targetOrientation, rotationAlpha)

    if (this.object) {
      this.object.position.copy(this.currentPosition)
      this.object.quaternion.copy(this.orientation)
    }
  }

  dispose(): void {
    if (this.object) {
      this.object.removeFromParent()
      if (Array.isArray(this.object.material)) {
        this.object.material.forEach((material) => material.dispose())
      } else {
        this.object.material.dispose()
      }
      this.object = null
    }
  }
}
