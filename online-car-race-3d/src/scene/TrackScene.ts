import * as THREE from 'three'
import type { CarState, TrackData } from '../core/trackTypes'
import { ARCADE_SAMPLE_TRACK, SAMPLE_TRACK } from '../core/trackSample'
import { createRandom } from '../core/random'
import { TrackMeshBuilder } from '../render/TrackMeshBuilder'
import { applyDecorators } from '../render/DecorGenerator'
import { CameraRig } from '../render/CameraRig'

export class TrackScene {
  private readonly scene: THREE.Scene
  private readonly cameraRig: CameraRig
  private readonly track: TrackData
  private readonly cars: Map<string, THREE.Mesh>
  private time = 0

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, cameraRig: CameraRig) {
    this.scene = scene
    camera.up.set(0, 1, 0)
    this.cameraRig = cameraRig
    this.track = SAMPLE_TRACK // Swap to SAMPLE_TRACK for a simpler oval
    this.cars = new Map()

    this.initializeScene()
  }

  update(dt: number): void {
    this.time += dt
    for (const car of this.cars.values()) {
      car.rotation.y += dt * 0.5
      const wobbleOffset = Number(car.userData.wobbleOffset ?? 0)
      car.position.y = 1
      car.position.x += Math.sin(this.time * 0.6 + wobbleOffset) * 0.004
      car.position.z += Math.cos(this.time * 0.6 + wobbleOffset) * 0.004
    }
  }

  private initializeScene(): void {
    const random = createRandom(this.track.seed)

    const builder = new TrackMeshBuilder()
    const trackMesh = builder.build(this.track)
    this.scene.add(trackMesh)

    applyDecorators(this.track, this.scene, random)

    this.spawnDummyCars()
    this.focusCamera()
  }

  private spawnDummyCars(): void {
    const carGeometry = new THREE.BoxGeometry(4, 1.5, 2)
    const colors = [0xff5555, 0x55aaff]
    const startingPositions: Array<Pick<CarState, 'playerId' | 'x' | 'z'>> = [
      { playerId: 'player-1', x: this.track.centerline[0].x, z: this.track.centerline[0].z - 2 },
      { playerId: 'player-2', x: this.track.centerline[0].x - 4, z: this.track.centerline[0].z + 2 },
    ]

    startingPositions.forEach((start, index) => {
      const material = new THREE.MeshStandardMaterial({
        color: colors[index % colors.length],
        metalness: 0.2,
        roughness: 0.6,
      })
      const mesh = new THREE.Mesh(carGeometry, material)
      mesh.castShadow = true
      mesh.position.set(start.x, 1, start.z)
      mesh.rotation.y = Math.PI / 2
      mesh.name = start.playerId
      mesh.userData.wobbleOffset = index * Math.PI
      this.scene.add(mesh)
      this.cars.set(start.playerId, mesh)
    })
  }

  private focusCamera(): void {
    const center = this.computeTrackCenter()
    this.cameraRig.setTarget(center)
  }

  private computeTrackCenter(): THREE.Vector3 {
    const sum = this.track.centerline.reduce(
      (acc, point) => {
        acc.x += point.x
        acc.z += point.z
        return acc
      },
      { x: 0, z: 0 },
    )

    const count = this.track.centerline.length || 1
    return new THREE.Vector3(sum.x / count, 0, sum.z / count)
  }
}
