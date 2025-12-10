import * as THREE from 'three'
import type { ItemType } from '../core/trackTypes'

const FALLBACK_COLORS: Record<ItemType, number> = {
  nitro: 0x4ad1ff,
  shoot: 0xff6b4a,
}

export class ItemModelLoader {
  private readonly cache = new Map<ItemType, Promise<THREE.Object3D>>()

  async createInstance(type: ItemType): Promise<THREE.Object3D> {
    const base = await this.loadModel(type)
    return base.clone()
  }

  private loadModel(type: ItemType): Promise<THREE.Object3D> {
    const cached = this.cache.get(type)
    if (cached) {
      return cached
    }

    const promise = Promise.resolve(this.buildProceduralModel(type))
    this.cache.set(type, promise)
    return promise
  }

  private buildProceduralModel(type: ItemType): THREE.Object3D {
    if (type === 'shoot') {
      return this.buildProjectile(type)
    }
    return this.buildBoostCanister(type)
  }

  private buildBoostCanister(type: ItemType): THREE.Object3D {
    const group = new THREE.Group()
    group.name = `${type}-fallback`

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: FALLBACK_COLORS[type] ?? 0xffffff,
      emissiveIntensity: 0.25,
      roughness: 0.35,
      metalness: 0.1,
    })
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.1,
      roughness: 0.45,
      metalness: 0.3,
    })

    const capsule = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.9, 12, 1, true), bodyMaterial)
    capsule.name = `${type}-body`
    group.add(capsule)

    const band = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.06, 8, 16), accentMaterial)
    band.rotation.x = Math.PI / 2
    band.position.y = 0.0
    band.name = `${type}-band`
    group.add(band)

    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.25, 12), accentMaterial)
    cap.position.y = 0.55
    cap.name = `${type}-cap`
    group.add(cap)

    const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.35, 12), bodyMaterial)
    nozzle.rotation.x = Math.PI
    nozzle.position.y = -0.55
    nozzle.name = `${type}-nozzle`
    group.add(nozzle)

    return group
  }

  private buildProjectile(type: ItemType): THREE.Object3D {
    const group = new THREE.Group()
    group.name = `${type}-fallback`

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: FALLBACK_COLORS[type] ?? 0xff5a3c,
      emissiveIntensity: 0.2,
      roughness: 0.35,
      metalness: 0.2,
    })
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: 0x272727,
      emissiveIntensity: 0.05,
      roughness: 0.5,
      metalness: 0.4,
    })

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.8, 6, 10), bodyMaterial)
    body.rotation.z = Math.PI / 2
    body.name = `${type}-body`
    group.add(body)

    const fins = new THREE.Group()
    fins.name = `${type}-fins`
    const finShape = new THREE.Shape([
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.25, 0.05),
      new THREE.Vector2(0, 0.4),
    ])
    const finGeometry = new THREE.ExtrudeGeometry(finShape, { depth: 0.08, bevelEnabled: false })
    finGeometry.translate(-0.4, -0.2, -0.04)

    const finOffsets = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]
    finOffsets.forEach((angle, index) => {
      const fin = new THREE.Mesh(finGeometry, accentMaterial)
      fin.rotation.y = angle
      fin.position.x = -0.05
      fin.name = `${type}-fin-${index}`
      fins.add(fin)
    })
    group.add(fins)

    const glow = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.4, 10), new THREE.MeshStandardMaterial({
      color: 0xffb347,
      emissive: new THREE.Color(0xffb347),
      emissiveIntensity: 0.9,
      roughness: 0.2,
      metalness: 0,
      transparent: true,
      opacity: 0.85,
    }))
    glow.rotation.z = Math.PI / 2
    glow.rotation.x = Math.PI
    glow.position.x = -0.7
    glow.name = `${type}-glow`
    group.add(glow)

    return group
  }
}
