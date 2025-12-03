declare module 'three' {
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

  export class Matrix4 {}

  export class Camera extends Object3D {}

  export class Quaternion {
    set(x: number, y: number, z: number, w: number): this
    copy(q: Quaternion): this
    slerp(q: Quaternion, t: number): this
    setFromEuler(euler: Euler): this
  }

  export class Object3D {
    name: string
    position: Vector3
    rotation: Euler
    quaternion: Quaternion
    scale: Vector3
    matrix: Matrix4
    parent: Object3D | null
    userData: Record<string, any>
    add(...objects: Object3D[]): this
    remove(...objects: Object3D[]): this
    removeFromParent(): this
    traverse(callback: (object: Object3D) => void): void
    updateMatrix(): void
    updateMatrixWorld(force?: boolean): void
    lookAt(target: Vector3): void
    clone(): this
  }

  export class Texture {
    colorSpace: number
    mapping: number
    dispose(): void
  }

  export class Scene extends Object3D {
    background: Color | Texture | null
    environment: Texture | null
  }

  export class Color {
    constructor(hex?: ColorRepresentation)
    setHSL(h: number, s: number, l: number): this
    getHex(): number
    lerp(color: Color, alpha: number): this
    clone(): Color
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
  export const BackSide: number

  export class Clock {
    constructor()
    getDelta(): number
    getElapsedTime(): number
    elapsedTime: number
  }

  export class PositionalAudio extends Object3D {
    constructor(listener: AudioListener)
    context: AudioContext
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
    }
  }

  export class HemisphereLight extends Object3D {
    constructor(skyColor?: number | string, groundColor?: number | string, intensity?: number)
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
    dispose(): void
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
    constructor(radiusTop?: number, radiusBottom?: number, height?: number, radialSegments?: number)
    rotateZ(angle: number): this
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

  export class CatmullRomCurve3 extends Curve<Vector3> {
    constructor(points?: Vector3[], closed?: boolean, curveType?: string)
  }

  export class Material {
    constructor(parameters?: Record<string, unknown>)
    clone(): this
    needsUpdate: boolean
    dispose(): void
  }

  export class MeshStandardMaterial extends Material {
    constructor(parameters?: Record<string, unknown>)
    color: Color
    metalness: number
    roughness: number
    clone(): MeshStandardMaterial
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

  export class InstancedMesh extends Mesh {
    constructor(geometry: BufferGeometry, material: Material, count: number)
    setMatrixAt(index: number, matrix: Matrix4): void
    instanceMatrix: BufferAttribute
    dispose(): void
    isMesh: boolean
  }

  export class CanvasTexture extends Texture {
    constructor(canvas: HTMLCanvasElement)
  }

  export class PMREMGenerator {
    constructor(renderer: WebGLRenderer)
    fromEquirectangular(texture: Texture): { texture: Texture }
    dispose(): void
  }

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

declare module 'three/examples/jsm/utils/SkeletonUtils.js' {
  import type { Object3D } from 'three'

  export function clone<T extends Object3D>(source: T): T
}
