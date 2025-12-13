import * as THREE from 'three'
import type { Vec2 } from '../core/trackTypes'
import { TRACK_SURFACE_HEIGHT, type TrackBuildResult } from './TrackMeshBuilder'

interface GuardRailOptions {
  height: number
  radius: number
  offset: number
}

const DEFAULT_OPTIONS: GuardRailOptions = {
  height: 1.05,
  radius: 0.22,
  offset: 0.08,
}

export class GuardRailBuilder {
  private readonly leftMaterial: THREE.MeshStandardMaterial
  private readonly rightMaterial: THREE.MeshStandardMaterial
  private readonly options: GuardRailOptions

  constructor(options?: Partial<GuardRailOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.leftMaterial = new THREE.MeshStandardMaterial({
      color: 0x0b0118,
      emissive: 0xff00ff,
      emissiveIntensity: 3,
      roughness: 0.22,
      metalness: 0.35,
      transparent: true,
      opacity: 0.95,
    })
    this.rightMaterial = new THREE.MeshStandardMaterial({
      color: 0x01131f,
      emissive: 0x00ffff,
      emissiveIntensity: 3,
      roughness: 0.22,
      metalness: 0.35,
      transparent: true,
      opacity: 0.95,
    })
  }

  build(track: TrackBuildResult, trackWidth: number): THREE.Group | null {
    const { leftEdge, rightEdge, normals } = track
    if (leftEdge.length === 0 || rightEdge.length === 0) {
      return null
    }

    const group = new THREE.Group()
    group.name = 'track-guard-rails'

    const leftCurve = this.createRailCurve(leftEdge, normals, 'left', trackWidth)
    const rightCurve = this.createRailCurve(rightEdge, normals, 'right', trackWidth)

    this.addRailMesh(group, leftCurve, this.leftMaterial, 'left')
    this.addRailMesh(group, rightCurve, this.rightMaterial, 'right')

    return group.children.length > 0 ? group : null
  }

  private createRailCurve(
    edge: Vec2[],
    normals: Vec2[],
    side: 'left' | 'right',
    trackWidth: number,
  ): THREE.CatmullRomCurve3 {
    const offset = trackWidth * this.options.offset
    const points = edge.map((edgePoint, index) => {
      const outwardNormal = this.getOutwardNormal(side, normals[index] ?? { x: 0, z: 1 })
      return new THREE.Vector3(
        edgePoint.x + outwardNormal.x * offset,
        TRACK_SURFACE_HEIGHT + this.options.height,
        edgePoint.z + outwardNormal.z * offset,
      )
    })
    return new THREE.CatmullRomCurve3(points, true, 'centripetal')
  }

  private addRailMesh(
    group: THREE.Group,
    curve: THREE.CatmullRomCurve3,
    material: THREE.MeshStandardMaterial,
    side: 'left' | 'right',
  ): void {
    if (curve.points.length < 2) {
      return
    }
    const tubularSegments = Math.max(curve.points.length * 3, 160)
    const geometry = new THREE.TubeGeometry(
      curve,
      tubularSegments,
      this.options.radius,
      10,
      true,
    )
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.userData.collision = { type: 'guard-rail', blocking: true, side }
    group.add(mesh)
  }

  private getOutwardNormal(side: 'left' | 'right', rightNormal: Vec2): Vec2 {
    if (side === 'right') {
      return rightNormal
    }
    return { x: -rightNormal.x, z: -rightNormal.z }
  }
}
