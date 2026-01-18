import * as THREE from 'three'
import type { CarState, ItemState, MissileState, TrackData } from '../core/trackTypes'
import { createRandom } from '../core/random'
import { TrackMeshBuilder } from '../render/TrackMeshBuilder'
import { applyDecorators } from '../render/DecorGenerator'
import { CameraRig } from '../render/CameraRig'
import type { GameStateStore } from '../state/GameStateStore'
import { CarModelLoader } from '../render/CarModelLoader'
import { CarEntity } from '../render/CarEntity'
import { GuardRailBuilder } from '../render/GuardRailBuilder'
import type { AudioManager } from '../audio/AudioManager'
import { MissileEntity } from '../render/MissileEntity'
import { ItemEntity } from '../render/ItemEntity'
import { ItemModelLoader } from '../render/ItemModelLoader'
import { hashPlayerIdToHue } from '../core/playerColor'
import { STATIC_CAMERA_PRESETS, type StaticCameraPreset } from './StaticCameraPresets'

export class TrackScene {
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly cameraRig: CameraRig
  private readonly store: GameStateStore
  private readonly carModelLoader: CarModelLoader
  private readonly guardRailBuilder: GuardRailBuilder
  private readonly mainLight: THREE.DirectionalLight | null
  private readonly mainLightDistance: number
  private readonly fillLight: THREE.DirectionalLight | null
  private readonly fillLightDistance: number
  private readonly rimLight: THREE.DirectionalLight | null
  private readonly rimLightDistance: number
  private readonly spotLight: THREE.SpotLight | null
  private readonly cars: Map<string, CarEntity>
  private readonly missiles: Map<string, MissileEntity>
  private readonly items: Map<string, ItemEntity>
  private readonly playerColors: Map<string, THREE.Color>
  private readonly audioManager: AudioManager | null
  private readonly onPlayerAutoFollow?: () => void
  private readonly onTrackCenterChange?: (center: THREE.Vector3) => void
  private readonly ownerNpcMap = new Map<string, boolean>()
  private readonly activeCarIds = new Set<string>()
  private readonly activeMissileIds = new Set<string>()
  private readonly activeItemIds = new Set<string>()
  private itemSyncInFlight = false
  private pendingItemStates: ItemState[] | null = null
  private trackRoot: THREE.Group | null = null
  private currentTrackId: string | null = null
  private playerId: string | null = null
  private cameraMode: 'static' | 'overview' | 'follow' | 'firstPerson' = 'overview'
  private readonly staticCameraPresets: StaticCameraPreset[]
  private staticCameraIndex = 0
  private lastStaticCameraIndex: number | null = null
  private staticCameraDirty = false
  private requestedFollowId: string | null = null
  private firstPersonHiddenId: string | null = null
  private hasAutoFollowedPlayer = false
  private readonly itemModelLoader: ItemModelLoader
  private readonly trackCenter = new THREE.Vector3()
  private readonly staticCameraWorldPosition = new THREE.Vector3()

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    cameraRig: CameraRig,
    store: GameStateStore,
    mainLight: THREE.DirectionalLight | null,
    fillLight: THREE.DirectionalLight | null,
    rimLight: THREE.DirectionalLight | null,
    spotLight: THREE.SpotLight | null,
    audioManager: AudioManager | null,
    onPlayerAutoFollow?: () => void,
    onTrackCenterChange?: (center: THREE.Vector3) => void,
  ) {
    this.scene = scene
    this.camera = camera
    camera.up.set(0, 1, 0)
    this.cameraRig = cameraRig
    this.store = store
    this.mainLight = mainLight
    this.mainLightDistance = mainLight
      ? mainLight.position.distanceTo(mainLight.target.position)
      : 0
    this.fillLight = fillLight
    this.fillLightDistance = fillLight
      ? fillLight.position.distanceTo(fillLight.target.position)
      : 0
    this.rimLight = rimLight
    this.rimLightDistance = rimLight
      ? rimLight.position.distanceTo(rimLight.target.position)
      : 0
    this.spotLight = spotLight
    this.carModelLoader = new CarModelLoader()
    this.guardRailBuilder = new GuardRailBuilder()
    this.staticCameraPresets = STATIC_CAMERA_PRESETS
    if (this.staticCameraPresets.length > 0) {
      this.cameraMode = 'static'
      this.staticCameraIndex = 0
    }
    this.cars = new Map()
    this.missiles = new Map()
    this.items = new Map()
    this.playerColors = new Map()
    this.audioManager = audioManager
    this.onPlayerAutoFollow = onPlayerAutoFollow
    this.onTrackCenterChange = onTrackCenterChange
    this.itemModelLoader = new ItemModelLoader()
    void this.carModelLoader.preload()
    window.addEventListener('keydown', this.handleKeyDown)

    this.store.onRoomInfo((info) => {
      const playerChanged = info.playerId !== this.playerId
      const trackChanged = info.track?.id !== this.currentTrackId
      this.playerId = info.playerId
      if (playerChanged) {
        this.hasAutoFollowedPlayer = false
      }
      if (info.track && trackChanged) {
        this.currentTrackId = info.track.id
        this.rebuildTrack(info.track)
      }
      if (info.playerId && this.cars.has(info.playerId)) {
        this.maybeActivatePlayerFollow(info.playerId)
      }
    })
  }

  setFollowTarget(playerId: string): void {
    this.requestedFollowId = playerId
    if (this.cameraMode === 'overview' || this.cameraMode === 'static') {
      this.cameraMode = 'follow'
    }
  }

  update(dt: number): void {
    const now = performance.now()
    const carStates = this.store.getCarsForRender(now)
    const missileStates = this.store.getMissilesForRender(now)
    const itemStates = this.store.getItemsForRender(now)
    // PERF: Reuse lookup tables/sets to reduce per-frame allocations.
    this.ownerNpcMap.clear()
    for (const state of carStates) {
      this.ownerNpcMap.set(state.playerId, Boolean(state.isNpc))
    }
    this.syncCars(carStates)
    this.syncMissiles(missileStates, this.ownerNpcMap)
    this.enqueueItemSync(itemStates)
    for (const entity of this.cars.values()) {
      entity.update(dt)
      entity.updateNameLabelScale(this.camera)
    }
    for (const missile of this.missiles.values()) {
      missile.update(dt)
    }
    for (const item of this.items.values()) {
      item.update(dt)
    }
    this.updateCameraFollow()
  }

  private rebuildTrack(track: TrackData): void {
    this.disposeTrackRoot()
    this.clearItems()

    const random = createRandom(track.seed)
    const builder = new TrackMeshBuilder()
    const result = builder.build(track)
    const center = result.bounds.getCenter(new THREE.Vector3())
    this.trackCenter.copy(center)
    this.staticCameraDirty = true
    this.onTrackCenterChange?.(center.clone())

    const group = new THREE.Group()
    group.name = 'track-root'
    group.add(result.mesh)
    const rails = this.guardRailBuilder.build(result, track.width)
    if (rails) {
      group.add(rails)
    }

    applyDecorators(track, result, group, random)

    this.scene.add(group)
    this.trackRoot = group
    this.focusCamera(center, result.bounds)
    this.updateLighting(center, result.bounds)
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

  private clearItems(): void {
    for (const item of this.items.values()) {
      item.dispose()
    }
    this.items.clear()
  }

  private syncCars(states: CarState[]): void {
    // PERF: Avoid recreating sets each frame when reconciling entities.
    this.activeCarIds.clear()
    for (const state of states) {
      this.activeCarIds.add(state.playerId)
      const entity = this.getOrCreateCar(state)
      entity.setNameLabelVisible(this.shouldShowLabelFor(state.playerId))
      entity.setTargetState(state)
    }

    for (const [playerId, entity] of this.cars.entries()) {
      if (!this.activeCarIds.has(playerId)) {
        entity.dispose()
        this.cars.delete(playerId)
        if (this.firstPersonHiddenId === playerId) {
          this.firstPersonHiddenId = null
        }
        if (playerId === this.playerId) {
          this.hasAutoFollowedPlayer = false
        }
      }
    }
  }

  private syncMissiles(states: MissileState[], ownerNpcMap: Map<string, boolean>): void {
    // PERF: Reuse set to minimize garbage while syncing missiles.
    this.activeMissileIds.clear()
    for (const state of states) {
      this.activeMissileIds.add(state.id)
      const ownerIsNpc = ownerNpcMap.get(state.ownerId)
      const entity = this.getOrCreateMissile(state, ownerIsNpc)
      entity.setTargetState(state)
    }

    for (const [missileId, entity] of this.missiles.entries()) {
      if (!this.activeMissileIds.has(missileId)) {
        entity.dispose()
        this.missiles.delete(missileId)
      }
    }
  }

  private enqueueItemSync(states: ItemState[]): void {
    if (this.itemSyncInFlight) {
      this.pendingItemStates = states
      return
    }

    this.itemSyncInFlight = true
    void this.runItemSync(states)
  }

  private async runItemSync(states: ItemState[]): Promise<void> {
    await this.syncItems(states)

    while (this.pendingItemStates) {
      const nextStates = this.pendingItemStates
      this.pendingItemStates = null
      await this.syncItems(nextStates)
    }

    this.itemSyncInFlight = false
  }

  private async syncItems(states: ItemState[]): Promise<void> {
    // PERF: Reuse set for item reconciliation while keeping async flow intact.
    this.activeItemIds.clear()
    for (const state of states) {
      this.activeItemIds.add(state.id)
      const entity = this.getOrCreateItem(state)
      await entity.setState(state)
    }

    for (const [itemId, entity] of this.items.entries()) {
      if (!this.activeItemIds.has(itemId)) {
        entity.dispose()
        this.items.delete(itemId)
      }
    }
  }

  private getOrCreateCar(state: CarState): CarEntity {
    let car = this.cars.get(state.playerId)
    const isNewCar = !car
    if (!car) {
      const color = this.getColorForState(state)
      car = new CarEntity(
        state.playerId,
        state.username ?? state.playerId,
        this.scene,
        this.carModelLoader,
        color,
        this.audioManager,
        this.shouldShowLabelFor(state.playerId),
      )
      this.cars.set(state.playerId, car)
    }
    if (isNewCar) {
      this.maybeActivatePlayerFollow(state.playerId)
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

  private getOrCreateItem(state: ItemState): ItemEntity {
    let item = this.items.get(state.id)
    if (!item) {
      item = new ItemEntity(state.id, state.type, this.scene, this.itemModelLoader)
      this.items.set(state.id, item)
    }
    return item
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
      const normalized = hashPlayerIdToHue(playerId)
      color = new THREE.Color()
      color.setHSL(normalized, 0.65, 0.5)
      this.playerColors.set(playerId, color)
    }

    return color.clone()
  }

  private focusCamera(center: THREE.Vector3, bounds: THREE.Box3): void {
    this.cameraRig.setTarget(center)
    this.cameraRig.frameBounds(bounds)
  }

  private updateLighting(center: THREE.Vector3, bounds: THREE.Box3): void {
    if (!this.mainLight && !this.fillLight && !this.rimLight) {
      return
    }

    const size = bounds.getSize(new THREE.Vector3())
    const margin = 25
    const halfSpan = Math.max(size.x, size.z) / 2 + margin
    const height = size.y + margin

    if (this.mainLight) {
      const direction = this.mainLight.position
        .clone()
        .sub(this.mainLight.target.position)
        .normalize()

      const distance = Math.max(this.mainLightDistance, halfSpan + height)
      this.mainLight.position.copy(center).addScaledVector(direction, distance)
      this.mainLight.target.position.copy(center)
      this.mainLight.target.updateMatrixWorld()

      // Snap light and target to shadow texels to reduce shimmering when moving.
      const shadowSize = this.mainLight.shadow.mapSize.width || 1024
      const texelSize = (halfSpan * 2) / shadowSize
      if (texelSize > 0) {
        const snap = (v: THREE.Vector3): void => {
          v.set(
            Math.round(v.x / texelSize) * texelSize,
            Math.round(v.y / texelSize) * texelSize,
            Math.round(v.z / texelSize) * texelSize,
          )
        }
        snap(this.mainLight.position)
        snap(this.mainLight.target.position)
        this.mainLight.target.updateMatrixWorld()
      }

      const shadowCamera = this.mainLight.shadow.camera as THREE.OrthographicCamera
      shadowCamera.left = -halfSpan
      shadowCamera.right = halfSpan
      shadowCamera.top = halfSpan
      shadowCamera.bottom = -halfSpan
      shadowCamera.near = Math.max(0.5, distance - (halfSpan + height))
      shadowCamera.far = distance + halfSpan + height
      shadowCamera.updateProjectionMatrix()
    }

    this.updateSecondaryLight(this.fillLight, this.fillLightDistance, center, halfSpan, height)
    this.updateSecondaryLight(this.rimLight, this.rimLightDistance, center, halfSpan, height)
    this.updateSpotLight(center, halfSpan, height)
  }

  private updateSecondaryLight(
    light: THREE.DirectionalLight | null,
    baseDistance: number,
    center: THREE.Vector3,
    halfSpan: number,
    height: number,
  ): void {
    if (!light) {
      return
    }
    const direction = light.position.clone().sub(light.target.position).normalize()
    const distance = Math.max(baseDistance, halfSpan + height * 0.6)
    light.position.copy(center).addScaledVector(direction, distance)
    light.target.position.copy(center)
    light.target.updateMatrixWorld()
  }

  private updateSpotLight(center: THREE.Vector3, halfSpan: number, height: number): void {
    if (!this.spotLight) {
      return
    }
    const distance = Math.max(halfSpan * 3.2, height + halfSpan * 2)
    this.spotLight.distance = distance
    this.spotLight.position.set(center.x + 24, center.y + distance, center.z + 6)
    this.spotLight.target.position.copy(center)
    this.spotLight.target.updateMatrixWorld()
    this.spotLight.angle = THREE.MathUtils.degToRad(58)
    this.spotLight.penumbra = 0.52
    this.spotLight.decay = 1.35
    this.spotLight.shadow.camera.near = 12
    this.spotLight.shadow.camera.far = distance + height * 1.2
  }

  private updateCameraFollow(): void {
    if (this.cameraMode === 'static') {
      this.updateFirstPersonVisibility(null)
      if (this.applyStaticCamera()) {
        return
      }
    }
    this.clearStaticCamera()
    if (this.cameraMode === 'overview') {
      this.updateFirstPersonVisibility(null)
      this.cameraRig.follow(null)
      return
    }

    const followEntity = this.resolveFollowEntity()
    this.updateFirstPersonVisibility(followEntity)
    const followObject = followEntity?.getObject() ?? null
    if (!followObject) {
      this.cameraRig.follow(null)
      return
    }

    this.cameraRig.follow(followObject, {
      lockRotation: followEntity?.isImpactSpinning() ?? false,
      mode: this.cameraMode === 'firstPerson' ? 'firstPerson' : 'chase',
    })
  }

  private applyStaticCamera(): boolean {
    const preset = this.staticCameraPresets[this.staticCameraIndex]
    if (!preset) {
      this.cameraMode = 'overview'
      this.clearStaticCamera()
      return false
    }
    if (this.lastStaticCameraIndex !== this.staticCameraIndex || this.staticCameraDirty) {
      this.cameraRig.follow(null)
      this.staticCameraWorldPosition.copy(this.trackCenter).add(preset.position)
      this.cameraRig.setStaticPose({
        position: this.staticCameraWorldPosition,
        rotation: preset.rotation,
      })
      this.lastStaticCameraIndex = this.staticCameraIndex
      this.staticCameraDirty = false
    }
    return true
  }

  private clearStaticCamera(): void {
    if (this.lastStaticCameraIndex === null) {
      return
    }
    this.cameraRig.setStaticPose(null)
    this.lastStaticCameraIndex = null
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

  private maybeActivatePlayerFollow(playerId: string): void {
    if (!this.playerId || playerId !== this.playerId) {
      return
    }
    if (this.hasAutoFollowedPlayer) {
      return
    }

    this.cameraMode = 'follow'
    this.requestedFollowId = playerId
    this.hasAutoFollowedPlayer = true
    this.onPlayerAutoFollow?.()
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key.toLowerCase() !== 'v') {
      return
    }
    const hasStatic = this.staticCameraPresets.length > 0
    if (hasStatic) {
      if (this.cameraMode === 'static') {
        if (this.staticCameraIndex < this.staticCameraPresets.length - 1) {
          this.staticCameraIndex += 1
        } else {
          this.cameraMode = 'overview'
        }
      } else if (this.cameraMode === 'overview') {
        if(this.activeCarIds.size > 0)
          this.cameraMode = 'follow'
        else{
          this.cameraMode = 'static'
        }
      } else if (this.cameraMode === 'follow') {
        this.cameraMode = 'firstPerson'
      } else {
        this.cameraMode = 'static'
        this.staticCameraIndex = 0
      }
    } else {
      this.cameraMode =
        this.cameraMode === 'overview'
          ? 'follow'
          : this.cameraMode === 'follow'
            ? 'firstPerson'
            : 'overview'
    }

    if (this.cameraMode === 'overview' || this.cameraMode === 'static') {
      this.cameraRig.follow(null)
      return
    }

    const playerHasCar = this.playerId ? this.cars.has(this.playerId) : false
    if (playerHasCar) {
      this.requestedFollowId = this.playerId
    }
  }

  private shouldShowLabelFor(playerId: string): boolean {
    return !this.playerId || playerId !== this.playerId
  }

  private updateFirstPersonVisibility(followEntity: CarEntity | null): void {
    if (this.cameraMode === 'firstPerson' && followEntity) {
      if (this.firstPersonHiddenId && this.firstPersonHiddenId !== followEntity.id) {
        const previous = this.cars.get(this.firstPersonHiddenId)
        previous?.setVisible(true)
      }
      followEntity.setVisible(false)
      this.firstPersonHiddenId = followEntity.id
      return
    }

    if (this.firstPersonHiddenId) {
      const previous = this.cars.get(this.firstPersonHiddenId)
      previous?.setVisible(true)
      this.firstPersonHiddenId = null
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown)
    this.disposeTrackRoot()
    this.clearItems()
    for (const car of this.cars.values()) {
      car.dispose()
    }
    this.cars.clear()
    for (const missile of this.missiles.values()) {
      missile.dispose()
    }
    this.missiles.clear()
  }
}
