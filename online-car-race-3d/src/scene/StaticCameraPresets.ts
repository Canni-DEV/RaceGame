import * as THREE from 'three'
import { getStringEnv } from '../core/env'

export type StaticCameraPreset = {
  position: THREE.Vector3
  rotation: THREE.Euler
}

type StaticCameraPresetConfig = {
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
}

const DEFAULT_STATIC_CAMERA_PRESETS: StaticCameraPresetConfig[] = [
  {
    position: { x: 0, y: 400, z: -800 },
    rotation: { x: -0.45, y: 3.135, z: 0 },
  }
]

const parseVector3 = (value: unknown): THREE.Vector3 | null => {
  if (!value || typeof value !== 'object') {
    return null
  }
  const candidate = value as { x?: unknown; y?: unknown; z?: unknown }
  if (
    typeof candidate.x !== 'number' ||
    typeof candidate.y !== 'number' ||
    typeof candidate.z !== 'number'
  ) {
    return null
  }
  return new THREE.Vector3(candidate.x, candidate.y, candidate.z)
}

const parseEuler = (value: unknown): THREE.Euler | null => {
  if (!value || typeof value !== 'object') {
    return null
  }
  const candidate = value as { x?: unknown; y?: unknown; z?: unknown }
  if (
    typeof candidate.x !== 'number' ||
    typeof candidate.y !== 'number' ||
    typeof candidate.z !== 'number'
  ) {
    return null
  }
  const rotation = new THREE.Euler(candidate.x, candidate.y, candidate.z)
  const rotationWithOrder = rotation as THREE.Euler & { order?: string }
  rotationWithOrder.order = 'YXZ'
  return rotation
}

const toPreset = (config: StaticCameraPresetConfig): StaticCameraPreset | null => {
  const position = parseVector3(config.position)
  const rotation = parseEuler(config.rotation)
  if (!position || !rotation) {
    return null
  }
  return { position, rotation }
}

const isPreset = (value: StaticCameraPreset | null): value is StaticCameraPreset => Boolean(value)

const buildDefaults = (defaults: StaticCameraPresetConfig[]): StaticCameraPreset[] => {
  return defaults.map((entry) => toPreset(entry)).filter(isPreset)
}

const parseStaticCameraPresets = (
  raw: string | null,
  defaults: StaticCameraPresetConfig[],
): StaticCameraPreset[] => {
  if (!raw) {
    return buildDefaults(defaults)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    console.warn('[StaticCameraPresets] Invalid JSON for VITE_STATIC_CAMERA_PRESETS.', error)
    return buildDefaults(defaults)
  }

  if (!Array.isArray(parsed)) {
    console.warn('[StaticCameraPresets] VITE_STATIC_CAMERA_PRESETS must be an array.')
    return buildDefaults(defaults)
  }

  const presets: StaticCameraPreset[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const preset = toPreset(entry as StaticCameraPresetConfig)
    if (preset) {
      presets.push(preset)
    }
  }

  if (presets.length > 0) {
    return presets
  }

  return buildDefaults(defaults)
}

export const STATIC_CAMERA_PRESETS = parseStaticCameraPresets(
  getStringEnv('VITE_STATIC_CAMERA_PRESETS', ''),
  DEFAULT_STATIC_CAMERA_PRESETS,
)
