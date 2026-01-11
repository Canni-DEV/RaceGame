import * as THREE from 'three'
import { getNumberEnv } from '../core/env'

type DebugCameraConfig = {
  moveSpeed: number
  lookSpeed: number
  boostMultiplier: number
}

const getDebugCameraConfig = (): DebugCameraConfig => ({
  moveSpeed: getNumberEnv('VITE_DEBUG_CAMERA_SPEED', 180),
  lookSpeed: getNumberEnv('VITE_DEBUG_CAMERA_LOOK_SPEED', 0.0025),
  boostMultiplier: getNumberEnv('VITE_DEBUG_CAMERA_BOOST', 3),
})

export class DebugCameraController {
  private readonly camera: THREE.PerspectiveCamera
  private readonly config: DebugCameraConfig
  private readonly pressedKeys = new Set<string>()
  private readonly movement = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()
  private readonly right = new THREE.Vector3()
  private readonly up = new THREE.Vector3(0, 1, 0)
  private readonly lastPointer = new THREE.Vector2()
  private isLooking = false
  private lookPointerId: number | null = null
  private yaw = 0
  private pitch = 0

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera
    this.config = getDebugCameraConfig()
    this.setCameraRotationOrder()
    this.syncRotationFromCamera()
  }

  update(dt: number): void {
    if (dt <= 0) {
      return
    }

    const movement = this.movement
    movement.set(0, 0, 0)

    this.forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize()
    this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize()

    if (this.pressedKeys.has('KeyW')) {
      movement.add(this.forward)
    }
    if (this.pressedKeys.has('KeyS')) {
      movement.addScaledVector(this.forward, -1)
    }
    if (this.pressedKeys.has('KeyA')) {
      movement.addScaledVector(this.right, -1)
    }
    if (this.pressedKeys.has('KeyD')) {
      movement.add(this.right)
    }
    if (this.pressedKeys.has('KeyE') || this.pressedKeys.has('Space')) {
      movement.add(this.up)
    }
    if (this.pressedKeys.has('KeyQ') || this.pressedKeys.has('ControlLeft')) {
      movement.addScaledVector(this.up, -1)
    }

    if (movement.lengthSq() < 1e-6) {
      return
    }

    movement.normalize()
    const boost =
      this.pressedKeys.has('ShiftLeft') || this.pressedKeys.has('ShiftRight')
        ? this.config.boostMultiplier
        : 1
    const speed = this.config.moveSpeed * boost
    this.camera.position.addScaledVector(movement, speed * dt)
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.isMovementKey(event.code)) {
      return false
    }
    this.pressedKeys.add(event.code)
    return true
  }

  handleKeyUp(event: KeyboardEvent): boolean {
    if (!this.isMovementKey(event.code)) {
      return false
    }
    this.pressedKeys.delete(event.code)
    return true
  }

  handlePointerDown(event: PointerEvent): boolean {
    if (event.button !== 2) {
      return false
    }
    this.isLooking = true
    this.lookPointerId = event.pointerId
    this.lastPointer.set(event.clientX, event.clientY)
    return true
  }

  handlePointerMove(event: PointerEvent): boolean {
    if (!this.isLooking || this.lookPointerId !== event.pointerId) {
      return false
    }
    const dx = event.clientX - this.lastPointer.x
    const dy = event.clientY - this.lastPointer.y
    this.lastPointer.set(event.clientX, event.clientY)

    this.yaw -= dx * this.config.lookSpeed
    this.pitch -= dy * this.config.lookSpeed
    this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI * 0.49, Math.PI * 0.49)
    this.camera.rotation.set(this.pitch, this.yaw, 0)
    return true
  }

  handlePointerUp(event: PointerEvent): boolean {
    if (!this.isLooking || this.lookPointerId !== event.pointerId) {
      return false
    }
    this.isLooking = false
    this.lookPointerId = null
    return true
  }

  private syncRotationFromCamera(): void {
    this.pitch = this.camera.rotation.x
    this.yaw = this.camera.rotation.y
  }

  private setCameraRotationOrder(): void {
    const rotation = this.camera.rotation as THREE.Euler & { order?: string }
    rotation.order = 'YXZ'
  }

  private isMovementKey(code: string): boolean {
    return (
      code === 'KeyW' ||
      code === 'KeyA' ||
      code === 'KeyS' ||
      code === 'KeyD' ||
      code === 'KeyQ' ||
      code === 'KeyE' ||
      code === 'Space' ||
      code === 'ShiftLeft' ||
      code === 'ShiftRight' ||
      code === 'ControlLeft'
    )
  }
}
