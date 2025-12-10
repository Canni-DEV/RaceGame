import * as THREE from 'three'
import type { ItemState, ItemType } from '../core/trackTypes'
import { TRACK_SURFACE_HEIGHT } from './TrackMeshBuilder'
import { ItemModelLoader } from './ItemModelLoader'

const FLOAT_AMPLITUDE = 0.35
const FLOAT_SPEED = 1.5
const SPIN_SPEED = Math.PI

export class ItemEntity {
  readonly id: string
  private readonly scene: THREE.Scene
  private readonly loader: ItemModelLoader
  private object: THREE.Object3D | null = null
  private readonly position = new THREE.Vector3(0, TRACK_SURFACE_HEIGHT, 0)
  private targetType: ItemType
  private destroyed = false
  private animationPhase = 0

  constructor(id: string, type: ItemType, scene: THREE.Scene, loader: ItemModelLoader) {
    this.id = id
    this.scene = scene
    this.loader = loader
    this.targetType = type
    void this.spawn(type)
  }

  private async spawn(type: ItemType): Promise<void> {
    const object = await this.loader.createInstance(type)
    if (this.destroyed) {
      return
    }
    object.position.copy(this.position)
    this.scene.add(object)
    this.object = object
  }

  async setState(state: ItemState): Promise<void> {
    this.position.set(state.x, TRACK_SURFACE_HEIGHT + 1.05, state.z)
    if (state.type !== this.targetType) {
      this.targetType = state.type
      this.clearObject()
      await this.spawn(state.type)
    }

    if (this.object) {
      this.object.position.copy(this.position)
      this.object.rotation.y = state.angle
    }
  }

  update(dt: number): void {
    if (!this.object) {
      return
    }

    this.animationPhase = (this.animationPhase + dt * FLOAT_SPEED) % (Math.PI * 2)
    const bobOffset = Math.sin(this.animationPhase) * FLOAT_AMPLITUDE
    this.object.position.y = this.position.y + bobOffset
    this.object.rotation.y += dt * SPIN_SPEED
  }

  dispose(): void {
    this.destroyed = true
    this.clearObject()
  }

  private clearObject(): void {
    if (!this.object) {
      return
    }
    this.object.removeFromParent()
    this.object = null
  }
}
