import * as THREE from 'three'
import type { CarState, TrackData } from '../core/trackTypes'
import { createRandom } from '../core/random'
import { TrackMeshBuilder, type TrackBuildResult } from '../render/TrackMeshBuilder'
import { applyDecorators } from '../render/DecorGenerator'
import { CameraRig } from '../render/CameraRig'
import type { GameStateStore } from '../state/GameStateStore'
import { CarModelLoader } from '../render/CarModelLoader'
import { CarEntity } from '../render/CarEntity'
import { GuardRailBuilder } from '../render/GuardRailBuilder'

export class TrackScene {
  private readonly scene: THREE.Scene
  private readonly cameraRig: CameraRig
  private readonly store: GameStateStore
  private readonly carModelLoader: CarModelLoader
  private readonly guardRailBuilder: GuardRailBuilder
  private readonly cars: Map<string, CarEntity>
  private readonly playerColors: Map<string, THREE.Color>
  private trackRoot: THREE.Group | null = null
  private playerId: string | null = null
  private cameraMode: 'overview' | 'follow' = 'overview'
  private requestedFollowId: string | null = null

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    cameraRig: CameraRig,
    store: GameStateStore,
  ) {
    this.scene = scene
    camera.up.set(0, 1, 0)
    this.cameraRig = cameraRig
    this.store = store
    this.carModelLoader = new CarModelLoader()
    this.guardRailBuilder = new GuardRailBuilder()
    this.cars = new Map()
    this.playerColors = new Map()
    void this.carModelLoader.preload()
    window.addEventListener('keydown', this.handleKeyDown)

    this.store.onRoomInfo((info) => {
      this.playerId = info.playerId
      if (info.track) {
        this.rebuildTrack(info.track)
      }
    })
  }

  update(dt: number): void {
    const now = performance.now()
    const carStates = this.store.getCarsForRender(now)
    this.syncCars(carStates)
    for (const entity of this.cars.values()) {
      entity.update(dt)
    }
    this.updateCameraFollow()
  }

  private rebuildTrack(track: TrackData): void {
    this.disposeTrackRoot()

    const random = createRandom(track.seed)
    const builder = new TrackMeshBuilder()
    const result = builder.build(track)

    const group = new THREE.Group()
    group.name = 'track-root'
    group.add(result.mesh)
    const rails = this.guardRailBuilder.build(result, track.width)
    if (rails) {
      group.add(rails)
    }

    applyDecorators(track, group, random)

    this.scene.add(group)
    this.trackRoot = group
    this.focusCamera(result)
  }

  private disposeTrackRoot(): void {
    if (!this.trackRoot) {
      return
    }

    this.scene.remove(this.trackRoot)
    this.trackRoot.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) {
        object.geometry.dispose()
        if (Array.isArray(object.material)) {
          for (const material of object.material) {
            material.dispose()
          }
        } else {
          object.material.dispose()
        }
        object.dispose()
      } else if (object instanceof THREE.Mesh) {
        object.geometry.dispose()
        if (Array.isArray(object.material)) {
          for (const material of object.material) {
            material.dispose()
          }
        } else {
          object.material.dispose()
        }
      }
    })

    this.trackRoot = null
  }

  private syncCars(states: CarState[]): void {
    const active = new Set<string>()
    for (const state of states) {
      active.add(state.playerId)
      const entity = this.getOrCreateCar(state)
      entity.setTargetState(state)
    }

    for (const [playerId, entity] of this.cars.entries()) {
      if (!active.has(playerId)) {
        entity.dispose()
        this.cars.delete(playerId)
      }
    }
  }

  private getOrCreateCar(state: CarState): CarEntity {
    let car = this.cars.get(state.playerId)
    if (!car) {
      const color = this.getColorForState(state)
      car = new CarEntity(state.playerId, this.scene, this.carModelLoader, color)
      this.cars.set(state.playerId, car)
    }
    return car
  }

  private getColorForState(state: CarState): THREE.Color {
    if (state.isNpc) {
      return new THREE.Color(0xffa133)
    }
    let color = this.playerColors.get(state.playerId)
    if (!color) {
      let hash = 0
      for (let i = 0; i < state.playerId.length; i++) {
        hash = (hash * 31 + state.playerId.charCodeAt(i)) | 0
      }
      const normalized = (hash & 0xffff) / 0xffff
      color = new THREE.Color()
      color.setHSL((normalized + 1) % 1, 0.65, 0.5)
      this.playerColors.set(state.playerId, color)
    }
    return color.clone()
  }

  private focusCamera(track: TrackBuildResult): void {
    const center = track.bounds.getCenter(new THREE.Vector3())
    this.cameraRig.setTarget(center)
    this.cameraRig.frameBounds(track.bounds)
  }

  private updateCameraFollow(): void {
    if (this.cameraMode !== 'follow') {
      this.cameraRig.follow(null)
      return
    }

    const followEntity = this.resolveFollowEntity()
    this.cameraRig.follow(followEntity?.getObject() ?? null)
  }

  private resolveFollowEntity(): CarEntity | null {
    if (this.requestedFollowId) {
      const requested = this.cars.get(this.requestedFollowId)
      if (requested) {
        return requested
      }
    }

    if (this.playerId) {
      const playerCar = this.cars.get(this.playerId)
      if (playerCar) {
        this.requestedFollowId = this.playerId
        return playerCar
      }
    }

    const firstEntry = this.cars.entries().next()
    if (!firstEntry.done) {
      const [playerId, car] = firstEntry.value
      this.requestedFollowId = playerId
      return car
    }
    return null
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key.toLowerCase() !== 'f') {
      return
    }
    this.cameraMode = this.cameraMode === 'overview' ? 'follow' : 'overview'
    if (this.cameraMode === 'overview') {
      this.cameraRig.follow(null)
    } else {
      this.requestedFollowId = this.playerId
    }
  }
}
