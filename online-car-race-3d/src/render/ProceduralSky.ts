import * as THREE from 'three'

export interface ProceduralSkyOptions {
  radius?: number
  topColor?: THREE.ColorRepresentation
  middleColor?: THREE.ColorRepresentation
  bottomColor?: THREE.ColorRepresentation
  horizonExponent?: number
  timeOfDay?: number
  cloudSpeed?: number
  cloudCoverage?: number
  cloudOpacity?: number
}

export class ProceduralSky {
  readonly mesh: THREE.Mesh
  private readonly material: THREE.ShaderMaterial
  private readonly uniforms: Record<string, THREE.IUniform>

  constructor(options: ProceduralSkyOptions = {}) {
    const {
      radius = 560,
      topColor = '#6fa8ff',
      middleColor = '#9cd0ff',
      bottomColor = '#f7efe5',
      horizonExponent = 1.5,
      timeOfDay = 0.2,
      cloudSpeed = 0.015,
      cloudCoverage = 0.42,
      cloudOpacity = 0.55,
    } = options

    this.uniforms = {
      topColor: { value: new THREE.Color(topColor) },
      middleColor: { value: new THREE.Color(middleColor) },
      bottomColor: { value: new THREE.Color(bottomColor) },
      horizonExponent: { value: horizonExponent },
      timeOfDay: { value: timeOfDay },
      cloudSpeed: { value: cloudSpeed },
      cloudCoverage: { value: cloudCoverage },
      cloudOpacity: { value: cloudOpacity },
      time: { value: 0 },
    }

    const geometry = new THREE.SphereGeometry(radius, 64, 32)

    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: this.uniforms,
      vertexShader: `
        varying vec3 vWorldPosition;

        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vWorldPosition;

        uniform vec3 topColor;
        uniform vec3 middleColor;
        uniform vec3 bottomColor;
        uniform float horizonExponent;
        uniform float timeOfDay;
        uniform float cloudSpeed;
        uniform float cloudCoverage;
        uniform float cloudOpacity;
        uniform float time;

        // Simple value noise (2D)
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float valueNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);

          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));

          vec2 u = f * f * (3.0 - 2.0 * f);

          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        float fbm(vec2 p) {
          float value = 0.0;
          float amplitude = 0.55;
          float frequency = 1.0;

          for (int i = 0; i < 4; i++) {
            value += valueNoise(p * frequency) * amplitude;
            frequency *= 2.05;
            amplitude *= 0.55;
          }

          return value;
        }

        vec3 computeSkyGradient(vec3 direction) {
          float h = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
          float curved = pow(h, horizonExponent);

          vec3 warmTint = vec3(1.0, 0.62, 0.38);
          vec3 horizonBase = mix(bottomColor, warmTint, timeOfDay * 0.85);
          vec3 middleBase = mix(middleColor, warmTint, timeOfDay * 0.5);
          vec3 topBase = mix(topColor, vec3(0.86, 0.9, 1.0), timeOfDay * 0.25);

          float lowerBlend = smoothstep(0.0, 0.55, curved);
          float upperBlend = smoothstep(0.35, 1.0, curved);

          vec3 gradient = mix(horizonBase, middleBase, lowerBlend);
          gradient = mix(gradient, topBase, upperBlend);
          return gradient;
        }

        vec4 computeClouds(vec3 direction) {
          vec2 drift = vec2(time * cloudSpeed, time * cloudSpeed * 0.35);
          float variation = sin(time * 0.05) * 0.03;
          float coverage = clamp(cloudCoverage + variation, 0.05, 0.95);

          vec2 wrapped = normalize(direction.xz + vec2(1e-4, 1e-4));
          float heightBand = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
          vec2 noiseCoord = wrapped * vec2(2.8, 1.85) + drift + vec2(0.0, heightBand * 0.65);
          float primary = fbm(noiseCoord);
          float detail = valueNoise(noiseCoord * 2.0 + 13.37) * 0.25;
          float combined = clamp(primary * 0.85 + detail, 0.0, 1.0);

          float softness = 0.08;
          float density = smoothstep(coverage, 1.0, combined);
          float feather = smoothstep(coverage - softness, coverage + softness, combined);
          float alpha = density * feather * cloudOpacity;

          vec3 warmTint = vec3(1.0, 0.62, 0.38);
          vec3 cloudColor = mix(vec3(1.0), warmTint, timeOfDay * 0.8);
          cloudColor = mix(cloudColor, vec3(1.02, 1.06, 1.12), 0.2);

          return vec4(clamp(alpha, 0.0, 1.0), cloudColor);
        }

        void main() {
          vec3 direction = normalize(vWorldPosition - cameraPosition);
          vec3 skyColor = computeSkyGradient(direction);

          vec4 cloudData = computeClouds(direction);
          float cloudAlpha = cloudData.x;
          vec3 cloudColor = cloudData.yzw;

          vec3 finalColor = mix(skyColor, cloudColor, cloudAlpha);
          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
    })

    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.name = 'procedural-sky'
    this.mesh.frustumCulled = false
  }

  update(deltaTime: number, cameraPosition?: THREE.Vector3): void {
    if (cameraPosition) {
      this.mesh.position.copy(cameraPosition)
    }
    this.uniforms.time.value += deltaTime
  }

  setTimeOfDay(value: number): void {
    this.uniforms.timeOfDay.value = THREE.MathUtils.clamp(value, 0, 1)
  }

  setCloudOpacity(value: number): void {
    this.uniforms.cloudOpacity.value = THREE.MathUtils.clamp(value, 0, 1)
  }

  setCloudCoverage(value: number): void {
    this.uniforms.cloudCoverage.value = THREE.MathUtils.clamp(value, 0, 1)
  }
}
