import * as THREE from 'three'
import type { Vec2 } from '../core/trackTypes'
import { TRACK_SURFACE_HEIGHT, type TrackBuildResult } from './TrackMeshBuilder'

interface GuardRailOptions {
  curvatureThreshold: number
  height: number
  radius: number
}

const DEFAULT_OPTIONS: GuardRailOptions = {
  curvatureThreshold: 0.01,
  height: 1.1,
  radius: 0.35,
}

export class GuardRailBuilder {
  private readonly options: GuardRailOptions
  private readonly materials: Record<'left' | 'right', THREE.MeshStandardMaterial>

  constructor(options?: Partial<GuardRailOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.materials = {
      left: new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x00ffff),
        emissive: new THREE.Color(0x00ffff),
        emissiveIntensity: 3.6,
        metalness: 0.05,
        roughness: 0.18,
      }),
      right: new THREE.MeshStandardMaterial({
        color: new THREE.Color(0xff00ff),
        emissive: new THREE.Color(0xff00ff),
        emissiveIntensity: 3.8,
        metalness: 0.05,
        roughness: 0.18,
      }),
    }
  }

  build(track: TrackBuildResult, trackWidth: number): THREE.Group | null {
    const { curvature, leftEdge, rightEdge, normals } = track
    if (curvature.length === 0) {
      return null
    }

    const group = new THREE.Group()
    group.name = 'track-guard-rails'

    const segments: { points: THREE.Vector3[]; side: 'left' | 'right' }[] = []
    let current: THREE.Vector3[] = []
    let currentSide: 'left' | 'right' | null = null

    const pushSegment = () => {
      if (current.length > 1 && currentSide) {
        segments.push({ points: current.slice(), side: currentSide })
      }
      current = []
      currentSide = null
    }

    for (let i = 0; i < curvature.length; i++) {
      const amount = curvature[i]
      if (Math.abs(amount) < this.options.curvatureThreshold) {
        pushSegment()
        continue
      }
      const side: 'left' | 'right' = amount > 0 ? 'right' : 'left'
      if (side !== currentSide) {
        pushSegment()
        currentSide = side
      }
      const edgePoints = side === 'right' ? rightEdge : leftEdge
      const outwardNormal = this.getOutwardNormal(side, normals[i])
      const edge = edgePoints[i]
      const point = new THREE.Vector3(
        edge.x + outwardNormal.x * trackWidth * 0.05,
        this.options.height + TRACK_SURFACE_HEIGHT,
        edge.z + outwardNormal.z * trackWidth * 0.05,
      )
      current.push(point)
    }

    pushSegment()

    for (const segment of segments) {
      const mesh = this.createRailMesh(segment.points, segment.side)
      if (!mesh) {
        continue
      }
      mesh.userData.collision = { type: 'guard-rail', blocking: true, side: segment.side }
      group.add(mesh)
    }

    return group.children.length > 0 ? group : null
  }

  private createRailMesh(
    points: THREE.Vector3[],
    side: 'left' | 'right',
  ): THREE.Mesh | null {
    if (points.length < 2) {
      return null
    }
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal')
    const tubularSegments = Math.max(points.length * 3, 32)
    const geometry = new THREE.TubeGeometry(
      curve,
      tubularSegments,
      this.options.radius,
      6,
      false,
    )
    const mesh = new THREE.Mesh(geometry, this.materials[side])
    mesh.castShadow = false
    mesh.receiveShadow = false
    return mesh
  }

  private getOutwardNormal(side: 'left' | 'right', rightNormal: Vec2): Vec2 {
    if (side === 'right') {
      return rightNormal
    }
    return { x: -rightNormal.x, z: -rightNormal.z }
  }
}
