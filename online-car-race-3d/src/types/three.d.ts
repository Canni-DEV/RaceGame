declare module 'three' {
  export class Vector3 {
    constructor(x?: number, y?: number, z?: number)
    x: number
    y: number
    z: number
    set(x: number, y: number, z: number): this
    copy(v: Vector3): this
  }

  export class Euler {
    x: number
    y: number
    z: number
    set(x: number, y: number, z: number): this
  }

  export class Matrix4 {}

  export class Object3D {
    name: string
    position: Vector3
    rotation: Euler
    scale: Vector3
    matrix: Matrix4
    userData: Record<string, any>
    add(...objects: Object3D[]): this
    updateMatrix(): void
    lookAt(target: Vector3): void
  }

  export class Scene extends Object3D {
    background: Color | null
  }

  export class Color {
    constructor(hex?: number | string)
  }

  export class PerspectiveCamera extends Object3D {
    constructor(fov?: number, aspect?: number, near?: number, far?: number)
    aspect: number
    up: Vector3
    lookAt(target: Vector3): void
    updateProjectionMatrix(): void
  }

  export class OrthographicCamera extends Object3D {
    near: number
    far: number
    left: number
    right: number
    top: number
    bottom: number
  }

  export class WebGLRenderer {
    constructor(params?: { antialias?: boolean })
    domElement: HTMLCanvasElement
    shadowMap: { enabled: boolean; type: number }
    setPixelRatio(ratio: number): void
    setSize(width: number, height: number): void
    render(scene: Scene, camera: PerspectiveCamera): void
  }

  export const PCFSoftShadowMap: number

  export class Clock {
    constructor()
    getDelta(): number
  }

  export class AmbientLight extends Object3D {
    constructor(color?: number | string, intensity?: number)
  }

  export class DirectionalLight extends Object3D {
    constructor(color?: number | string, intensity?: number)
    castShadow: boolean
    shadow: {
      mapSize: { width: number; height: number }
      camera: OrthographicCamera
    }
  }

  export class Group extends Object3D {}

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
  }

  export class Material {
    constructor(parameters?: Record<string, unknown>)
  }

  export class MeshStandardMaterial extends Material {
    constructor(parameters?: Record<string, unknown>)
  }

  export class Mesh<TGeometry extends BufferGeometry = BufferGeometry> extends Object3D {
    constructor(geometry?: TGeometry, material?: Material | Material[])
    receiveShadow: boolean
    castShadow: boolean
    name: string
  }

  export class InstancedMesh extends Mesh {
    constructor(geometry: BufferGeometry, material: Material, count: number)
    setMatrixAt(index: number, matrix: Matrix4): void
    instanceMatrix: BufferAttribute
  }

  export const MathUtils: {
    lerp(a: number, b: number, t: number): number
  }
}
