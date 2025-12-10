import * as THREE from 'three'

export interface SpaceSkyOptions {
  radius?: number
  baseColor?: THREE.ColorRepresentation
  nebulaPrimary?: THREE.ColorRepresentation
  nebulaSecondary?: THREE.ColorRepresentation
  starColor?: THREE.ColorRepresentation
  starDensity?: number
  twinkleSpeed?: number
}

export class SpaceSky {
  readonly mesh: THREE.Mesh
  private readonly uniforms: Record<string, THREE.IUniform>

  constructor(options: SpaceSkyOptions = {}) {
    const {
      radius = 560,
      baseColor = '#030711',
      nebulaPrimary = '#0b1e4a',
      nebulaSecondary = '#2d0c3f',
      starColor = '#8df5ff',
      starDensity = 260.0,
      twinkleSpeed = 0.2,
    } = options

    this.uniforms = {
      baseColor: { value: new THREE.Color(baseColor) },
      nebulaPrimary: { value: new THREE.Color(nebulaPrimary) },
      nebulaSecondary: { value: new THREE.Color(nebulaSecondary) },
      starColor: { value: new THREE.Color(starColor) },
      starDensity: { value: starDensity },
      twinkleSpeed: { value: twinkleSpeed },
      time: { value: 0 },
    }

    const geometry = new THREE.SphereGeometry(radius, 64, 32)
    const material = new THREE.ShaderMaterial({
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

        uniform vec3 baseColor;
        uniform vec3 nebulaPrimary;
        uniform vec3 nebulaSecondary;
        uniform vec3 starColor;
        uniform float starDensity;
        uniform float twinkleSpeed;
        uniform float time;

        float hash13(vec3 p) {
          p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }

        float valueNoise(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          vec3 u = f * f * (3.0 - 2.0 * f);

          float n000 = hash13(i);
          float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
          float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
          float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
          float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
          float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
          float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
          float n111 = hash13(i + vec3(1.0, 1.0, 1.0));

          float nx00 = mix(n000, n100, u.x);
          float nx10 = mix(n010, n110, u.x);
          float nx01 = mix(n001, n101, u.x);
          float nx11 = mix(n011, n111, u.x);

          float nxy0 = mix(nx00, nx10, u.y);
          float nxy1 = mix(nx01, nx11, u.y);

          return mix(nxy0, nxy1, u.z);
        }

        float fbm(vec3 p) {
          float amplitude = 0.55;
          float frequency = 1.5;
          float sum = 0.0;

          for (int i = 0; i < 5; i++) {
            sum += valueNoise(p * frequency) * amplitude;
            frequency *= 1.9;
            amplitude *= 0.55;
          }

          return sum;
        }

        vec3 nebula(vec3 direction) {
          float layerA = fbm(direction * 4.0 + vec3(time * 0.02, time * 0.015, 0.0));
          float layerB = fbm(direction * 7.5 + vec3(-time * 0.01, time * 0.008, time * 0.012));
          float combined = pow(layerA * 0.6 + layerB * 0.4, 2.2);

          vec3 blend = mix(nebulaPrimary, nebulaSecondary, combined);
          return blend * combined;
        }

        float starfield(vec3 direction) {
          vec3 grid = normalize(direction) * starDensity;
          float sparkle = hash13(floor(grid));
          float twinkle = sin(time * twinkleSpeed + sparkle * 12.0) * 0.5 + 0.5;
          float brightness = pow(sparkle, 12.0) * twinkle;
          return brightness;
        }

        void main() {
          vec3 direction = normalize(vWorldPosition - cameraPosition);
          vec3 nebulaColor = nebula(direction);
          float stars = starfield(direction);

          vec3 color = baseColor + nebulaColor;
          color += starColor * stars;

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    })

    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.name = 'space-sky'
    this.mesh.frustumCulled = false
  }

  update(deltaTime: number, cameraPosition?: THREE.Vector3): void {
    if (cameraPosition) {
      this.mesh.position.copy(cameraPosition)
    }
    this.uniforms.time.value += deltaTime
  }
}
