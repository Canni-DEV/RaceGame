import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'

interface VisualOptions {
  background: THREE.ColorRepresentation
  fogDensity: number
}

export class VisualManager {
  private readonly scene: THREE.Scene
  private readonly renderer: THREE.WebGLRenderer
  private readonly camera: THREE.PerspectiveCamera
  private readonly options: VisualOptions
  private readonly composer: EffectComposer
  private readonly bloomPass: UnrealBloomPass

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) {
    this.scene = scene
    this.renderer = renderer
    this.camera = camera
    this.options = {
      background: 0x050510,
      fogDensity: 0.006,
    }

    this.configureAtmosphere()
    this.configureLights()

    const size = new THREE.Vector2()
    this.renderer.getSize(size)
    this.composer = new EffectComposer(this.renderer)
    const renderPass = new RenderPass(this.scene, this.camera)
    this.composer.addPass(renderPass)

    this.bloomPass = new UnrealBloomPass(size, 1.5, 0.5, 0.2)
    this.bloomPass.threshold = 0.2
    this.bloomPass.strength = 1.5
    this.bloomPass.radius = 0.5
    this.composer.addPass(this.bloomPass)
    this.composer.setSize(size.x, size.y)
  }

  render(): void {
    this.composer.render()
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height)
    this.bloomPass.setSize(width, height)
  }

  private configureAtmosphere(): void {
    const background = new THREE.Color(this.options.background)
    this.scene.background = background
    this.scene.fog = new THREE.FogExp2(background, this.options.fogDensity)

    const width = 256
    const height = 256
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    const gradient = context.createRadialGradient(
      width * 0.5,
      height * 0.5,
      height * 0.1,
      width * 0.5,
      height * 0.5,
      height * 0.7,
    )
    gradient.addColorStop(0, '#0a0f3a')
    gradient.addColorStop(1, '#03030a')
    context.fillStyle = gradient
    context.fillRect(0, 0, width, height)

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.mapping = THREE.EquirectangularReflectionMapping

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer)
    const envMap = pmremGenerator.fromEquirectangular(texture).texture
    pmremGenerator.dispose()

    this.scene.environment = envMap
  }

  private configureLights(): void {
    const hemisphere = new THREE.HemisphereLight(0x0d1733, 0x000000, 0.5)
    hemisphere.position.set(0, 200, 0)
    this.scene.add(hemisphere)
  }
}
