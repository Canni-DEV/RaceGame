import * as THREE from 'three'

export class StarField {
  readonly points: THREE.Points

  constructor(count = 5200, radius = 1800) {
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(count * 3)

    for (let i = 0; i < count; i++) {
      const phi = Math.acos(2 * Math.random() - 1)
      const theta = Math.random() * Math.PI * 2
      const r = Math.cbrt(Math.random()) * radius

      const x = r * Math.sin(phi) * Math.cos(theta)
      const y = r * Math.cos(phi)
      const z = r * Math.sin(phi) * Math.sin(theta)

      positions[i * 3] = x
      positions[i * 3 + 1] = y
      positions[i * 3 + 2] = z
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))

    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 2.0,
      sizeAttenuation: true,
      fog: false,
      depthWrite: false,
    })

    this.points = new THREE.Points(geometry, material)
    this.points.name = 'star-field'
  }

  update(delta: number): void {
    this.points.rotation.y += delta * 0.02
  }
}
