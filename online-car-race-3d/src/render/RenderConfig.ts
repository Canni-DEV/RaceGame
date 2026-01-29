// Lighting tuned for “living cálido con scalextric”: key overhead + practical lamp + subtle bounce.
export const RENDER_CONFIG = {
  renderer: {
    toneMappingExposure: 0.92,
    maxPixelRatio: 1,
    shadowMapSize: {
      min: 1024,
      max: 2048,
    },
  },
  lights: {
    ambient: { color: 0xf1e0c8, intensity: 0.16 },
    hemisphere: { skyColor: 0xf4e8d4, groundColor: 0x3b2c22, intensity: 0.18 },
    key: {
      color: 0xffe6c4,
      intensity: 3.5,
      position: { x: 70, y: 280, z: 50 },
      shadow: {
        bias: -0.00008,
        normalBias: 0.035,
      },
    },
    practical: {
      color: 0xffc48a,
      intensity: 0.55,
      positionOffset: { x: 150, y: 120, z: -140 },
      distance: 420,
      angleDeg: 52,
      penumbra: 0.45,
      decay: 1.35,
      castShadow: false,
      shadowMapSize: 1024,
    },
  },
  postprocessing: {
    bloom: { strength: 0.2, radius: 0.16, threshold: 0.9 },
    ssao: { kernelRadius: 3, minDistance: 0.0012, maxDistance: 0.1 },
  },
  materials: {
    ground: {
      emissiveIntensity: 0.9,
    },
  },
}
