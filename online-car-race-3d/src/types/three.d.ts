declare module 'three' {
  export class Vector2 {
    constructor(x?: number, y?: number)
    x: number
    y: number
    set(x: number, y: number): this
    clone(): Vector2
  }

  export class Vector3 {
    constructor(x?: number, y?: number, z?: number)
    x: number
    y: number
    z: number
    set(x: number, y: number, z: number): this
    copy(v: Vector3): this
    setScalar(value: number): this
    clone(): Vector3
    sub(v: Vector3): this
    add(v: Vector3): this
    addScaledVector(v: Vector3, scale: number): this
    subVectors(a: Vector3, b: Vector3): this
    lerp(v: Vector3, alpha: number): this
    normalize(): this
    length(): number
    lengthSq(): number
    distanceTo(v: Vector3): number
    applyQuaternion(q: Quaternion): this
  }

  export class Euler {
    constructor(x?: number, y?: number, z?: number)
    x: number
    y: number
    z: number
    set(x: number, y: number, z: number): this
  }

  export class Matrix4 {
    clone(): Matrix4
    multiplyMatrices(a: Matrix4, b: Matrix4): this
  }

  export class Camera extends Object3D {}

  export class Quaternion {
    set(x: number, y: number, z: number, w: number): this
    copy(q: Quaternion): this
    multiply(q: Quaternion): this
    slerp(q: Quaternion, t: number): this
    setFromEuler(euler: Euler): this
    setFromAxisAngle(axis: Vector3, angle: number): this
  }

  export class Object3D {
    name: string
    type: string
    position: Vector3
    rotation: Euler
    quaternion: Quaternion
    scale: Vector3
    matrix: Matrix4
    matrixWorld: Matrix4
    visible: boolean
    parent: Object3D | null
    userData: Record<string, any>
    renderOrder: number
    add(...objects: Object3D[]): this
    remove(...objects: Object3D[]): this
    removeFromParent(): this
    getObjectByName(name: string): Object3D | undefined
    traverse(callback: (object: Object3D) => void): void
    updateMatrix(): void
    updateMatrixWorld(force?: boolean): void
    lookAt(target: Vector3): void
    clone(): this
  }

  export class Texture {
    colorSpace: number
    mapping: number
    image: { width: number; height: number }
    needsUpdate: boolean
    wrapS: number
    wrapT: number
    repeat: Vector2
    anisotropy: number
    dispose(): void
  }

  export class Scene extends Object3D {
    background: Color | Texture | null
    environment: Texture | null
  }

  export class Color {
    constructor(r?: number | ColorRepresentation, g?: number, b?: number)
    r: number
    g: number
    b: number
    setHSL(h: number, s: number, l: number): this
    setHex(hex: number): this
    copy(color: Color): this
    getHex(): number
    getHexString(): string
    getStyle(): string
    lerp(color: Color, alpha: number): this
    clone(): Color
  }

  export class SpriteMaterial extends Material {
    constructor(params?: { map?: Texture; depthWrite?: boolean; depthTest?: boolean; transparent?: boolean })
    map: Texture | null
  }

  export class Sprite extends Object3D {
    constructor(material?: SpriteMaterial)
    material: SpriteMaterial
    scale: Vector3
  }

  export type ColorRepresentation = number | string | Color
  export interface IUniform {
    value: any
  }

  export class PerspectiveCamera extends Object3D {
    constructor(fov?: number, aspect?: number, near?: number, far?: number)
    fov: number
    aspect: number
    near: number
    far: number
    up: Vector3
    lookAt(target: Vector3): void
    updateProjectionMatrix(): void
  }

  export class AudioListener extends Object3D {
    constructor()
    context: AudioContext
  }

  export class Audio extends Object3D {
    constructor(listener: AudioListener)
    context: AudioContext
    isPlaying: boolean
    onEnded?: () => void
    setBuffer(buffer: AudioBuffer): this
    setLoop(value: boolean): this
    setVolume(value: number): this
    play(): this
    stop(): this
  }

  export class OrthographicCamera extends Object3D {
    near: number
    far: number
    left: number
    right: number
    top: number
    bottom: number
    updateProjectionMatrix(): void
  }

  export class WebGLRenderer {
    constructor(params?: { antialias?: boolean })
    domElement: HTMLCanvasElement
    shadowMap: { enabled: boolean; type: number }
    outputColorSpace: number
    toneMapping: number
    toneMappingExposure: number
    physicallyCorrectLights: boolean
    setPixelRatio(ratio: number): void
    setSize(width: number, height: number): void
    render(scene: Scene, camera: PerspectiveCamera): void
  }

  export const PCFSoftShadowMap: number
  export const FrontSide: number
  export const BackSide: number
  export const DoubleSide: number
  export const BasicShadowMap: number
  export const ClampToEdgeWrapping: number
  export const RepeatWrapping: number
  export const NoToneMapping: number

  export class Clock {
    constructor()
    getDelta(): number
    getElapsedTime(): number
    elapsedTime: number
  }

  export class PositionalAudio extends Audio {
    getOutput(): AudioNode
    setRefDistance(value: number): this
    setRolloffFactor(value: number): this
    setDistanceModel(value: 'linear' | 'inverse' | 'exponential'): this
  }

  export class AmbientLight extends Object3D {
    constructor(color?: number | string, intensity?: number)
  }

  export class DirectionalLight extends Object3D {
    constructor(color?: number | string, intensity?: number)
    castShadow: boolean
    target: Object3D
    shadow: {
      mapSize: { width: number; height: number; set?: (width: number, height: number) => void }
      camera: OrthographicCamera
      bias?: number
      normalBias?: number
      radius?: number
    }
  }

  export class HemisphereLight extends Object3D {
    constructor(skyColor?: number | string, groundColor?: number | string, intensity?: number)
  }

  export class PointLight extends Object3D {
    constructor(color?: number | string, intensity?: number, distance?: number, decay?: number)
    color: Color
    intensity: number
    distance: number
    decay: number
  }

  export class SpotLight extends Object3D {
    constructor(
      color?: number | string,
      intensity?: number,
      distance?: number,
      angle?: number,
      penumbra?: number,
      decay?: number,
    )
    color: Color
    intensity: number
    distance: number
    angle: number
    penumbra: number
    decay: number
    target: Object3D
  }

  export class Group extends Object3D {
    children: Object3D[]
  }

  export class BufferAttribute {
    needsUpdate: boolean
  }

  export class Float32BufferAttribute extends BufferAttribute {
    constructor(array: Iterable<number>, itemSize: number)
  }

  export class BufferGeometry {
    setIndex(index: number[] | BufferAttribute): this
    setAttribute(name: string, attribute: BufferAttribute): this
    computeVertexNormals(): void
    computeBoundingBox(): void
    boundingBox?: Box3 | null
    translate(x: number, y: number, z: number): this
    dispose(): void
  }

  export class Shape {
    constructor(points?: Vector2[])
    getPoints(divisions?: number): Vector2[]
  }

  export class SphereGeometry extends BufferGeometry {
    constructor(radius?: number, widthSegments?: number, heightSegments?: number)
    scale(x: number, y: number, z: number): this
  }

  export class PlaneGeometry extends BufferGeometry {
    constructor(width: number, height: number)
    rotateX(angle: number): this
  }

  export class ConeGeometry extends BufferGeometry {
    constructor(radius?: number, height?: number, radialSegments?: number)
    translate(x: number, y: number, z: number): this
  }

  export class BoxGeometry extends BufferGeometry {
    constructor(width?: number, height?: number, depth?: number)
    translate(x: number, y: number, z: number): this
  }

  export class CylinderGeometry extends BufferGeometry {
    constructor(
      radiusTop?: number,
      radiusBottom?: number,
      height?: number,
      radialSegments?: number,
      heightSegments?: number,
      openEnded?: boolean,
      thetaStart?: number,
      thetaLength?: number,
    )
    rotateZ(angle: number): this
  }

  export class TorusGeometry extends BufferGeometry {
    constructor(radius?: number, tube?: number, radialSegments?: number, tubularSegments?: number)
  }

  export class CapsuleGeometry extends BufferGeometry {
    constructor(radius?: number, length?: number, capSegments?: number, radialSegments?: number)
  }

  export class TubeGeometry extends BufferGeometry {
    constructor(
      path: Curve<Vector3>,
      tubularSegments?: number,
      radius?: number,
      radialSegments?: number,
      closed?: boolean,
    )
  }

  export class Curve<T> {
    getPoint(t: number): T
  }

  export interface ExtrudeGeometryOptions {
    depth?: number
    bevelEnabled?: boolean
  }

  export class ExtrudeGeometry extends BufferGeometry {
    constructor(shapes?: Shape | Shape[], options?: ExtrudeGeometryOptions)
  }

  export class CatmullRomCurve3 extends Curve<Vector3> {
    constructor(points?: Vector3[], closed?: boolean, curveType?: string)
  }

  export class Material {
    constructor(parameters?: Record<string, unknown>)
    type: string
    name: string
    clone(): this
    needsUpdate: boolean
    dispose(): void
  }

  export class MeshStandardMaterial extends Material {
    constructor(parameters?: Record<string, unknown>)
    color: Color
    metalness: number
    roughness: number
    envMapIntensity: number
    isMeshStandardMaterial: boolean
    clone(): MeshStandardMaterial
  }

  export class MeshBasicMaterial extends Material {
    constructor(parameters?: { map?: Texture | null; side?: number; depthWrite?: boolean; toneMapped?: boolean })
    map: Texture | null
  }

  export class ShaderMaterial extends Material {
    constructor(parameters?: {
      uniforms?: Record<string, IUniform>
      vertexShader?: string
      fragmentShader?: string
      side?: number
      depthWrite?: boolean
    })
    uniforms: Record<string, IUniform>
  }

  export class Mesh<TGeometry extends BufferGeometry = BufferGeometry> extends Object3D {
    constructor(geometry?: TGeometry, material?: Material | Material[])
    receiveShadow: boolean
    castShadow: boolean
    frustumCulled: boolean
    name: string
    geometry: TGeometry
    material: Material | Material[]
    isMesh: boolean
  }

  export class SkinnedMesh<TGeometry extends BufferGeometry = BufferGeometry> extends Mesh<TGeometry> {
    isSkinnedMesh: boolean
  }

  export class InstancedMesh extends Mesh {
    constructor(geometry: BufferGeometry, material: Material | Material[], count: number)
    setMatrixAt(index: number, matrix: Matrix4): void
    instanceMatrix: BufferAttribute
    dispose(): void
    isMesh: boolean
  }

  export class CanvasTexture extends Texture {
    constructor(canvas: HTMLCanvasElement)
  }

  export class VideoTexture extends Texture {
    constructor(video: HTMLVideoElement)
  }

  export class PMREMGenerator {
    constructor(renderer: WebGLRenderer)
    fromEquirectangular(texture: Texture): { texture: Texture }
    dispose(): void
  }

  export class LoadingManager {
    onStart?: (url: string, itemsLoaded: number, itemsTotal: number) => void
    onProgress?: (url: string, itemsLoaded: number, itemsTotal: number) => void
    onLoad?: () => void
    onError?: (url: string) => void
  }

  export const DefaultLoadingManager: LoadingManager

  export const MathUtils: {
    lerp(a: number, b: number, t: number): number
    clamp(value: number, min: number, max: number): number
    mapLinear(x: number, a1: number, a2: number, b1: number, b2: number): number
    degToRad(degrees: number): number
  }

  export class Box3 {
    min: Vector3
    max: Vector3
    setFromObject(object: Object3D): this
    getCenter(target: Vector3): Vector3
    getSize(target: Vector3): Vector3
    clone(): Box3
  }

  export type Intersection = {
    distance: number
    object: Object3D
    point: Vector3
  }

  export class Raycaster {
    constructor(origin?: Vector3, direction?: Vector3, near?: number, far?: number)
    setFromCamera(coords: Vector2, camera: Object3D): void
    intersectObject(object: Object3D, recursive?: boolean): Intersection[]
  }

  export class Buffer {
    constructor()
  }

  export const EquirectangularReflectionMapping: number
  export const SRGBColorSpace: number
  export const ACESFilmicToneMapping: number
}

declare module 'three/examples/jsm/loaders/GLTFLoader.js' {
  import type { Object3D } from 'three'

  export interface GLTF {
    scene: Object3D
  }

  export class GLTFLoader {
    loadAsync(path: string): Promise<GLTF>
  }
}

declare module 'three/examples/jsm/loaders/RGBELoader.js' {
  import type { Texture } from 'three'

  export class RGBELoader {
    loadAsync(path: string): Promise<Texture>
    setDataType?(type: number): this
  }
}

declare module 'three/examples/jsm/loaders/HDRLoader.js' {
  import type { Texture } from 'three'

  export class HDRLoader {
    loadAsync(path: string): Promise<Texture>
    setDataType?(type: number): this
  }
}

declare module 'three/examples/jsm/utils/SkeletonUtils.js' {
  import type { Object3D } from 'three'

  export function clone<T extends Object3D>(source: T): T
}

declare module 'three/examples/jsm/utils/BufferGeometryUtils.js' {
  import type { BufferGeometry } from 'three'

  export function mergeGeometries(geometries: BufferGeometry[], useGroups?: boolean): BufferGeometry
}

declare module 'three/examples/jsm/postprocessing/EffectComposer.js' {
  import type { WebGLRenderer } from 'three'

  export class EffectComposer {
    constructor(renderer: WebGLRenderer)
    setSize(width: number, height: number): void
    addPass(pass: { setSize?: (width: number, height: number) => void }): void
    render(): void
    dispose(): void
  }
}

declare module 'three/examples/jsm/postprocessing/RenderPass.js' {
  import type { Camera, Scene } from 'three'

  export class RenderPass {
    constructor(scene: Scene, camera: Camera)
  }
}

declare module 'three/examples/jsm/postprocessing/SSAOPass.js' {
  import type { Camera, Scene } from 'three'

  export class SSAOPass {
    constructor(scene: Scene, camera: Camera, width: number, height: number)
    kernelRadius: number
    minDistance: number
    maxDistance: number
    setSize(width: number, height: number): void
  }
}

declare module 'three/examples/jsm/postprocessing/UnrealBloomPass.js' {
  import type { Vector2 } from 'three'

  export class UnrealBloomPass {
    constructor(resolution: Vector2, strength?: number, radius?: number, threshold?: number)
    setSize(width: number, height: number): void
  }
}

declare module 'three/examples/jsm/postprocessing/BokehPass.js' {
  import type { Camera, Scene, ShaderMaterial } from 'three'

  export class BokehPass {
    constructor(
      scene: Scene,
      camera: Camera,
      params: { focus: number; aperture: number; maxblur: number; width?: number; height?: number },
    )
    materialBokeh: ShaderMaterial
    setSize(width: number, height: number): void
  }
}

declare module 'three/examples/jsm/postprocessing/ShaderPass.js' {
  import type { IUniform } from 'three'

  export class ShaderPass {
    constructor(shader: { uniforms: Record<string, IUniform> })
    uniforms: Record<string, IUniform>
    setSize(width: number, height: number): void
  }
}

declare module 'three/examples/jsm/shaders/VignetteShader.js' {
  import type { IUniform } from 'three'

  export const VignetteShader: { uniforms: Record<string, IUniform> }
}

declare module 'three/examples/jsm/shaders/HueSaturationShader.js' {
  import type { IUniform } from 'three'

  export const HueSaturationShader: { uniforms: Record<string, IUniform> }
}

declare module 'three/examples/jsm/shaders/BrightnessContrastShader.js' {
  import type { IUniform } from 'three'

  export const BrightnessContrastShader: { uniforms: Record<string, IUniform> }
}
