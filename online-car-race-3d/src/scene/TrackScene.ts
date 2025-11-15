import * as THREE from 'three'
import type { CarState, TrackData } from '../core/trackTypes'
import { createRandom } from '../core/random'
import { TrackMeshBuilder } from '../render/TrackMeshBuilder'
import { applyDecorators } from '../render/DecorGenerator'
import { CameraRig } from '../render/CameraRig'
import type { GameStateStore } from '../state/GameStateStore'

export class TrackScene {
  private readonly scene: THREE.Scene
  private readonly cameraRig: CameraRig
  private readonly store: GameStateStore
  private readonly carGeometry: THREE.BoxGeometry
  private readonly cars: Map<string, THREE.Mesh>
  private readonly carMaterials: Map<string, THREE.MeshStandardMaterial>
  private trackRoot: THREE.Group | null = null

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
    this.carGeometry = new THREE.BoxGeometry(4, 1.5, 2)
    this.cars = new Map()
    this.carMaterials = new Map()

    this.store.onRoomInfo((info) => {
      if (info.track) {
        this.rebuildTrack(info.track)
      }
    })
  }

  update(_dt: number): void {
    const now = performance.now()
    const carStates = this.store.getCarsForRender(now)
    this.updateCars(carStates)
  }

  private rebuildTrack(track: TrackData): void {
    this.disposeTrackRoot()

    const random = createRandom(track.seed)
    const builder = new TrackMeshBuilder()
    const trackMesh = builder.build(track)

    const group = new THREE.Group()
    group.name = 'track-root'
    group.add(trackMesh)

    applyDecorators(track, group, random)

    this.scene.add(group)
    this.trackRoot = group
    this.focusCamera(track)
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

  private updateCars(states: CarState[]): void {
    const active = new Set<string>()

    for (const state of states) {
      active.add(state.playerId)
      const mesh = this.getOrCreateCarMesh(state)
      mesh.position.set(state.x, 1, state.z)
      mesh.rotation.y = state.angle
    }

    for (const [playerId, mesh] of this.cars.entries()) {
      if (!active.has(playerId)) {
        mesh.removeFromParent()
        this.cars.delete(playerId)
      }
    }
  }

  private getOrCreateCarMesh(state: CarState): THREE.Mesh {
    let mesh = this.cars.get(state.playerId)
    if (!mesh) {
      const material = this.getMaterialForState(state)
      mesh = new THREE.Mesh(this.carGeometry, material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.name = state.playerId
      this.scene.add(mesh)
      this.cars.set(state.playerId, mesh)
    }
    return mesh
  }

  private getMaterialForState(state: CarState): THREE.MeshStandardMaterial {
    let material = this.carMaterials.get(state.playerId)
    if (!material) {
      const color = state.isNpc ? 0xffaa33 : this.colorFromId(state.playerId)
      material = new THREE.MeshStandardMaterial({
        color,
        metalness: 0.25,
        roughness: 0.6,
      })
      this.carMaterials.set(state.playerId, material)
    }
    return material
  }

  private colorFromId(playerId: string): number {
    let hash = 0
    for (let i = 0; i < playerId.length; i++) {
      hash = (hash * 31 + playerId.charCodeAt(i)) | 0
    }
    const normalized = (hash & 0xffff) / 0xffff
    const color = new THREE.Color()
    color.setHSL((normalized + 1) % 1, 0.65, 0.55)
    return color.getHex()
  }

  private focusCamera(track: TrackData): void {
    const center = this.computeTrackCenter(track)
    this.cameraRig.setTarget(center)
  }

  private computeTrackCenter(track: TrackData): THREE.Vector3 {
    if (track.centerline.length === 0) {
      return new THREE.Vector3(0, 0, 0)
    }

    const sum = track.centerline.reduce(
      (acc, point) => {
        acc.x += point.x
        acc.z += point.z
        return acc
      },
      { x: 0, z: 0 },
    )

    const count = track.centerline.length || 1
    return new THREE.Vector3(sum.x / count, 0, sum.z / count)
  }
}
