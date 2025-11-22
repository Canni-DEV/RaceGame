import * as THREE from 'three'
import type { TrackData, Vec2 } from '../core/trackTypes'
import { add, normalize, rightNormal, scale, signedAngle, sub } from '../core/math2d'

export const TRACK_SURFACE_HEIGHT = 0.1
const TRACK_THICKNESS = 0.08
const TRACK_BASE_HEIGHT = TRACK_SURFACE_HEIGHT - TRACK_THICKNESS

export interface TrackBuildResult {
  mesh: THREE.Mesh
  centerline: Vec2[]
  leftEdge: Vec2[]
  rightEdge: Vec2[]
  normals: Vec2[]
  curvature: number[]
  bounds: THREE.Box3
}

const MIN_SUBDIVISIONS = 4
const MAX_SUBDIVISIONS = 18

export class TrackMeshBuilder {
  build(track: TrackData): TrackBuildResult {
    if (track.centerline.length < 2) {
      throw new Error('Track centerline must contain at least two points')
    }

    const smoothCenterline = this.generateSmoothCenterline(track.centerline)
    const metadata = this.computeEdges(smoothCenterline, track.width / 2)
    const geometry = this.buildGeometry(metadata.leftEdge, metadata.rightEdge)
    const material = new THREE.MeshStandardMaterial({
      color: 0x1f1f26,
      metalness: 0.15,
      roughness: 0.65,
    })

    const mesh = new THREE.Mesh(geometry, material)
    mesh.receiveShadow = true
    mesh.castShadow = false

    const bounds = geometry.boundingBox?.clone() ?? new THREE.Box3().setFromObject(mesh)

    return {
      mesh,
      centerline: smoothCenterline,
      leftEdge: metadata.leftEdge,
      rightEdge: metadata.rightEdge,
      normals: metadata.normals,
      curvature: metadata.curvature,
      bounds,
    }
  }

  private generateSmoothCenterline(points: Vec2[]): Vec2[] {
    const result: Vec2[] = []
    const count = points.length

    for (let i = 0; i < count; i++) {
      const p0 = points[(i - 1 + count) % count]
      const p1 = points[i]
      const p2 = points[(i + 1) % count]
      const p3 = points[(i + 2) % count]
      const curvature = Math.abs(signedAngle(sub(p1, p0), sub(p2, p1)))
      const t = THREE.MathUtils.clamp(curvature / Math.PI, 0, 1)
      const subdivisions = Math.max(
        MIN_SUBDIVISIONS,
        Math.floor(THREE.MathUtils.lerp(MIN_SUBDIVISIONS, MAX_SUBDIVISIONS, t)),
      )
      for (let j = 0; j < subdivisions; j++) {
        const u = j / subdivisions
        result.push(this.catmullRom(p0, p1, p2, p3, u))
      }
    }

    return result
  }

  private computeEdges(centerline: Vec2[], halfWidth: number) {
    const leftEdge: Vec2[] = []
    const rightEdge: Vec2[] = []
    const normals: Vec2[] = []
    const curvature: number[] = []
    const count = centerline.length

    for (let i = 0; i < count; i++) {
      const curr = centerline[i]
      const next = centerline[(i + 1) % count]
      const prev = centerline[(i - 1 + count) % count]
      const dir = normalize(sub(next, curr))
      const normal = rightNormal(dir)
      const leftNormal = scale(normal, -1)

      rightEdge.push(add(curr, scale(normal, halfWidth)))
      leftEdge.push(add(curr, scale(leftNormal, halfWidth)))
      normals.push(normal)

      const signed = signedAngle(sub(curr, prev), sub(next, curr))
      curvature.push(signed)

    }

    return { leftEdge, rightEdge, normals, curvature }
  }

  private buildGeometry(leftEdge: Vec2[], rightEdge: Vec2[]): THREE.BufferGeometry {
    const positions: number[] = []
    const uvs: number[] = []
    const indices: number[] = []
    const total = leftEdge.length

    const distances: number[] = new Array(total).fill(0)
    let accumulated = 0
    for (let i = 1; i < total; i++) {
      const prev = leftEdge[i - 1]
      const curr = leftEdge[i]
      accumulated += Math.hypot(curr.x - prev.x, curr.z - prev.z)
      distances[i] = accumulated
    }
    const closing = Math.hypot(
      leftEdge[0].x - leftEdge[total - 1].x,
      leftEdge[0].z - leftEdge[total - 1].z,
    )
    const totalDistance = accumulated + closing || 1

    for (let i = 0; i < total; i++) {
      const left = leftEdge[i]
      const right = rightEdge[i]
      const v = distances[i] / totalDistance

      positions.push(left.x, TRACK_SURFACE_HEIGHT, left.z)
      positions.push(right.x, TRACK_SURFACE_HEIGHT, right.z)
      positions.push(left.x, TRACK_BASE_HEIGHT, left.z)
      positions.push(right.x, TRACK_BASE_HEIGHT, right.z)

      uvs.push(0, v)
      uvs.push(1, v)
      uvs.push(0, v)
      uvs.push(1, v)
    }

    for (let i = 0; i < total; i++) {
      const next = (i + 1) % total
      const base = i * 4
      const nextBase = next * 4

      const topLeft = base
      const topRight = base + 1
      const bottomLeft = base + 2
      const bottomRight = base + 3
      const nextTopLeft = nextBase
      const nextTopRight = nextBase + 1
      const nextBottomLeft = nextBase + 2
      const nextBottomRight = nextBase + 3

      // Top surface
      indices.push(topLeft, nextTopRight, topRight)
      indices.push(topLeft, nextTopLeft, nextTopRight)

      // Bottom surface (flip winding)
      indices.push(bottomLeft, bottomRight, nextBottomRight)
      indices.push(bottomLeft, nextBottomRight, nextBottomLeft)

      // Left side
      indices.push(topLeft, bottomLeft, nextBottomLeft)
      indices.push(topLeft, nextBottomLeft, nextTopLeft)

      // Right side
      indices.push(topRight, nextTopRight, nextBottomRight)
      indices.push(topRight, nextBottomRight, bottomRight)
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setIndex(indices)
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.computeVertexNormals()
    geometry.computeBoundingBox()

    return geometry
  }

  private catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
    const v0 = (p2.x - p0.x) * 0.5
    const v1 = (p3.x - p1.x) * 0.5
    const w0 = (p2.z - p0.z) * 0.5
    const w1 = (p3.z - p1.z) * 0.5

    const t2 = t * t
    const t3 = t2 * t

    const x =
      (2 * p1.x - 2 * p2.x + v0 + v1) * t3 +
      (-3 * p1.x + 3 * p2.x - 2 * v0 - v1) * t2 +
      v0 * t +
      p1.x

    const z =
      (2 * p1.z - 2 * p2.z + w0 + w1) * t3 +
      (-3 * p1.z + 3 * p2.z - 2 * w0 - w1) * t2 +
      w0 * t +
      p1.z

    return { x, z }
  }
}
