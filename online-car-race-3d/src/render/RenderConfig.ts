export const RENDER_CONFIG = {
  renderer: {
    toneMappingExposure: 0.9,
    maxPixelRatio: 1,
    shadowMapSize: {
      min: 512,
      max: 1024,
    },
  },
  lights: {
    ambient: { color: 0xf3e5cf, intensity: 0.26 },
    hemisphere: { skyColor: 0xcad8ff, groundColor: 0x6b4b38, intensity: 0.23 },
    key: { color: 0xfff1d6, intensity: 1.05, position: { x: 70, y: 320, z: 60 } },
    fill: { color: 0xffe3bf, intensity: 0.17, position: { x: -140, y: 180, z: 120 } },
    rim: { color: 0xa8c2ff, intensity: 0.16, position: { x: 150, y: 160, z: -140 } },
    spot: {
      color: 0xffb671,
      intensity: 0.72,
      distance: 520,
      angleDeg: 55,
      penumbra: 0.32,
      decay: 0.8,
      position: { x: 0, y: 320, z: 0 },
    },
  },
  postprocessing: {
    bloom: { strength: 0.32, radius: 0.18, threshold: 0.88 },
    ssao: { kernelRadius: 7, minDistance: 0.0011, maxDistance: 0.12 },
  },
  materials: {
    ground: {
      emissiveIntensity: 0.08,
    },
  },
}
