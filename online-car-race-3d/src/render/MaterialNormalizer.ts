import * as THREE from 'three'

const DEFAULT_ROUGHNESS = 0.7
const DEFAULT_METALNESS = 0.1

export function normalizeMaterial(material: THREE.Material): THREE.MeshStandardMaterial {
  if (material instanceof THREE.MeshStandardMaterial) {
    material.roughness = material.roughness ?? DEFAULT_ROUGHNESS
    material.metalness = material.metalness ?? DEFAULT_METALNESS
    return material
  }

  if (material instanceof THREE.MeshBasicMaterial) {
    return new THREE.MeshStandardMaterial({
      color: material.color,
      map: material.map,
      transparent: material.transparent,
      opacity: material.opacity,
      side: material.side,
      roughness: 0.8,
      metalness: 0.0,
    })
  }

  const fallbackParams = material as THREE.Material & {
    color?: THREE.Color
    transparent?: boolean
    opacity?: number
    side?: number
  }
  return new THREE.MeshStandardMaterial({
    color: fallbackParams.color ?? new THREE.Color(0xffffff),
    transparent: fallbackParams.transparent ?? false,
    opacity: fallbackParams.opacity ?? 1,
    side: fallbackParams.side ?? THREE.FrontSide,
    roughness: DEFAULT_ROUGHNESS,
    metalness: DEFAULT_METALNESS,
  })
}
