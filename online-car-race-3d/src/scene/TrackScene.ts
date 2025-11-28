import * as THREE from 'three'
import type { CarState, MissileState, TrackData } from '../core/trackTypes'
import { createRandom } from '../core/random'
import { TrackMeshBuilder, type TrackBuildResult } from '../render/TrackMeshBuilder'
import { applyDecorators } from '../render/DecorGenerator'
import { CameraRig } from '../render/CameraRig'
import type { GameStateStore } from '../state/GameStateStore'
import { CarModelLoader } from '../render/CarModelLoader'
import { CarEntity } from '../render/CarEntity'
import { GuardRailBuilder } from '../render/GuardRailBuilder'
import type { AudioManager } from '../audio/AudioManager'
import { MissileEntity } from '../render/MissileEntity'

export class TrackScene {
  private readonly scene: THREE.Scene
  private readonly cameraRig: CameraRig
  private readonly store: GameStateStore
  private readonly carModelLoader: CarModelLoader
  private readonly guardRailBuilder: GuardRailBuilder
  private readonly mainLight: THREE.DirectionalLight | null
  private readonly mainLightDistance: number
  private readonly cars: Map<string, CarEntity>
  private readonly missiles: Map<string, MissileEntity>
  private readonly playerColors: Map<string, THREE.Color>
  private readonly audioManager: AudioManager | null
  private trackRoot: THREE.Group | null = null
  private playerId: string | null = null
  private cameraMode: 'overview' | 'follow' = 'overview'
  private requestedFollowId: string | null = null

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    cameraRig: CameraRig,
    store: GameStateStore,
    mainLight: THREE.DirectionalLight | null,
    audioManager: AudioManager | null,
  ) {
    this.scene = scene
    camera.up.set(0, 1, 0)
    this.cameraRig = cameraRig
    this.store = store
    this.mainLight = mainLight
    this.mainLightDistance = mainLight
      ? mainLight.position.distanceTo(mainLight.target.position)
      : 0
    this.carModelLoader = new CarModelLoader()
    this.guardRailBuilder = new GuardRailBuilder()
    this.cars = new Map()
    this.missiles = new Map()
    this.playerColors = new Map()
    this.audioManager = audioManager
    void this.carModelLoader.preload()
    window.addEventListener('keydown', this.handleKeyDown)

    this.store.onRoomInfo((info) => {
      this.playerId = info.playerId
      if (info.track) {
        this.rebuildTrack(info.track)
      }
    })
  }

  setFollowTarget(playerId: string): void {
    this.requestedFollowId = playerId
    this.cameraMode = 'follow'
  }

  update(dt: number): void {
    const now = performance.now()
    const carStates = this.store.getCarsForRender(now)
    const missileStates = this.store.getMissilesForRender(now)
    const ownerNpcMap = new Map<string, boolean>()
    for (const state of carStates) {
      ownerNpcMap.set(state.playerId, Boolean(state.isNpc))
    }
    this.syncCars(carStates)
    this.syncMissiles(missileStates, ownerNpcMap)
    for (const entity of this.cars.values()) {
      entity.update(dt)
    }
    for (const missile of this.missiles.values()) {
      missile.update(dt)
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
    this.updateLighting(result)
  }

  private disposeTrackRoot(): void {
    if (!this.trackRoot) {
      return
    }

    this.scene.remove(this.trackRoot)
    this.trackRoot.traverse((object) => {
      // Los assets decorativos comparten geometría/material vía la caché del loader;
      // si algún ancestro está marcado, omitimos la liberación de recursos.
      let current: THREE.Object3D | null = object
      while (current) {
        if (current.userData?.isTrackAsset) {
          return
        }
        current = current.parent
      }

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

  private syncMissiles(states: MissileState[], ownerNpcMap: Map<string, boolean>): void {
    const active = new Set<string>()
    for (const state of states) {
      active.add(state.id)
      const ownerIsNpc = ownerNpcMap.get(state.ownerId)
      const entity = this.getOrCreateMissile(state, ownerIsNpc)
      entity.setTargetState(state)
    }

    for (const [missileId, entity] of this.missiles.entries()) {
      if (!active.has(missileId)) {
        entity.dispose()
        this.missiles.delete(missileId)
      }
    }
  }

  private getOrCreateCar(state: CarState): CarEntity {
    let car = this.cars.get(state.playerId)
    if (!car) {
      const color = this.getColorForState(state)
      car = new CarEntity(
        state.playerId,
        this.scene,
        this.carModelLoader,
        color,
        this.audioManager,
      )
      this.cars.set(state.playerId, car)
    }
    return car
  }

  private getOrCreateMissile(state: MissileState, ownerIsNpc?: boolean): MissileEntity {
    let missile = this.missiles.get(state.id)
    if (!missile) {
      const color = this.getColorForPlayer(state.ownerId, ownerIsNpc)
      missile = new MissileEntity(state.id, this.scene, color)
      this.missiles.set(state.id, missile)
    }
    return missile
  }

  private getColorForState(state: CarState): THREE.Color {
    return this.getColorForPlayer(state.playerId, state.isNpc)
  }

  private getColorForPlayer(playerId: string, isNpc?: boolean): THREE.Color {
    if (isNpc) {
      let npcColor = this.playerColors.get(playerId)
      if (!npcColor) {
        npcColor = new THREE.Color(0xffa133)
        this.playerColors.set(playerId, npcColor)
      }
      return npcColor.clone()
    }

    let color = this.playerColors.get(playerId)
    if (!color) {
      let hash = 0
      for (let i = 0; i < playerId.length; i++) {
        hash = (hash * 31 + playerId.charCodeAt(i)) | 0
      }
      const normalized = (hash & 0xffff) / 0xffff
      color = new THREE.Color()
      color.setHSL((normalized + 1) % 1, 0.65, 0.5)
      this.playerColors.set(playerId, color)
    }

    return color.clone()
  }

  private focusCamera(track: TrackBuildResult): void {
    const center = track.bounds.getCenter(new THREE.Vector3())
    this.cameraRig.setTarget(center)
    this.cameraRig.frameBounds(track.bounds)
  }

  private updateLighting(track: TrackBuildResult): void {
    if (!this.mainLight) {
      return
    }

    const center = track.bounds.getCenter(new THREE.Vector3())
    const size = track.bounds.getSize(new THREE.Vector3())
    const margin = 40
    const halfSpan = Math.max(size.x, size.z) / 2 + margin
    const height = size.y + margin

    const direction = this.mainLight.position
      .clone()
      .sub(this.mainLight.target.position)
      .normalize()

    const distance = Math.max(this.mainLightDistance, halfSpan + height)
    this.mainLight.position.copy(center).addScaledVector(direction, distance)
    this.mainLight.target.position.copy(center)
    this.mainLight.target.updateMatrixWorld()

    const shadowCamera = this.mainLight.shadow.camera as THREE.OrthographicCamera
    shadowCamera.left = -halfSpan
    shadowCamera.right = halfSpan
    shadowCamera.top = halfSpan
    shadowCamera.bottom = -halfSpan
    shadowCamera.near = 1
    shadowCamera.far = distance + halfSpan + height
    shadowCamera.updateProjectionMatrix()
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
