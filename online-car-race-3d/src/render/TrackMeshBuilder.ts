import * as THREE from 'three'
import type { TrackData, Vec2 } from '../core/trackTypes'
import { normalize, rightNormal, sub } from '../core/math2d'

export class TrackMeshBuilder {
  build(track: TrackData): THREE.Mesh {
    const { width, centerline } = track
    if (centerline.length < 2) {
      throw new Error('Track centerline must contain at least two points')
    }

    const halfWidth = width / 2
    const leftSide: Vec2[] = []
    const rightSide: Vec2[] = []

    for (let i = 0; i < centerline.length; i++) {
      const curr = centerline[i]
      const next = centerline[(i + 1) % centerline.length]
      const dir = normalize(sub(next, curr))
      const normal = rightNormal(dir)

      rightSide.push({
        x: curr.x + normal.x * halfWidth,
        z: curr.z + normal.z * halfWidth,
      })
      leftSide.push({
        x: curr.x - normal.x * halfWidth,
        z: curr.z - normal.z * halfWidth,
      })
    }

    const positions: number[] = []
    const uvs: number[] = []
    const indices: number[] = []
    const total = centerline.length

    for (let i = 0; i < total; i++) {
      const v = i / total
      const left = leftSide[i]
      const right = rightSide[i]

      positions.push(left.x, 0, left.z)
      positions.push(right.x, 0, right.z)

      uvs.push(0, v)
      uvs.push(1, v)
    }

    for (let i = 0; i < total; i++) {
      const next = (i + 1) % total
      const iLeft = i * 2
      const iRight = iLeft + 1
      const nextLeft = next * 2
      const nextRight = nextLeft + 1

      indices.push(iLeft, nextRight, iRight)
      indices.push(iLeft, nextLeft, nextRight)
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setIndex(indices)
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.computeVertexNormals()

    const material = new THREE.MeshStandardMaterial({
      color: 0x2a2a2f,
      metalness: 0.1,
      roughness: 0.8,
    })

    const mesh = new THREE.Mesh(geometry, material)
    mesh.receiveShadow = true
    return mesh
  }
}
