import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

if (typeof FileReader === 'undefined') {
  globalThis.FileReader = class {
    constructor() {
      this.onloadend = null
      this.result = null
    }

    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = buffer
        this.onloadend?.()
      })
    }

    readAsDataURL(blob) {
      blob.arrayBuffer().then((buffer) => {
        const base64 = Buffer.from(buffer).toString('base64')
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${base64}`
        this.onloadend?.()
      })
    }
  }
}

const scene = new THREE.Group()
scene.name = 'SprintCar'

const bodyMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  metalness: 0.35,
  roughness: 0.45,
})

const cabinMaterial = bodyMaterial.clone()
cabinMaterial.metalness = 0.15
cabinMaterial.roughness = 0.2

const wheelMaterial = new THREE.MeshStandardMaterial({
  color: 0x111111,
  metalness: 0.1,
  roughness: 0.7,
})

const bodyGeometry = new THREE.BoxGeometry(1.6, 0.4, 3.6)
bodyGeometry.translate(0, 0.4, 0)
const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
body.name = 'Body'
scene.add(body)

const cabinGeometry = new THREE.BoxGeometry(1.1, 0.5, 1.6)
cabinGeometry.translate(0, 0.9, -0.2)
const cabin = new THREE.Mesh(cabinGeometry, cabinMaterial)
cabin.name = 'Cabin'
scene.add(cabin)

const spoilerGeometry = new THREE.BoxGeometry(1.4, 0.1, 0.8)
spoilerGeometry.translate(0, 0.85, -1.5)
const spoiler = new THREE.Mesh(spoilerGeometry, bodyMaterial.clone())
spoiler.name = 'Spoiler'
scene.add(spoiler)

const wheelGeometry = new THREE.CylinderGeometry(0.48, 0.48, 0.35, 16)
wheelGeometry.rotateZ(Math.PI / 2)

const wheelPositions = [
  [-0.85, 0.35, 1.3],
  [0.85, 0.35, 1.3],
  [-0.9, 0.35, -1.2],
  [0.9, 0.35, -1.2],
]

for (let i = 0; i < wheelPositions.length; i++) {
  const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial)
  const [x, y, z] = wheelPositions[i]
  wheel.position.set(x, y, z)
  wheel.name = `Wheel_${i}`
  scene.add(wheel)
}

const exporter = new GLTFExporter()

const outputPath = resolve('public/models/car.glb')
mkdirSync(dirname(outputPath), { recursive: true })

const handleExport = async (buffer) => {
    let arrayBuffer = buffer
    if (arrayBuffer instanceof ArrayBuffer === false) {
      if (ArrayBuffer.isView(arrayBuffer)) {
        arrayBuffer = arrayBuffer.buffer
      } else if (arrayBuffer && typeof arrayBuffer.arrayBuffer === 'function') {
        arrayBuffer = await arrayBuffer.arrayBuffer()
      } else {
        console.error('Unknown buffer type from exporter:', arrayBuffer?.constructor?.name, typeof arrayBuffer)
        console.error('Value preview:', arrayBuffer)
        throw new Error('Unexpected exporter buffer type')
      }
    }
    const data = Buffer.from(arrayBuffer)
    writeFileSync(outputPath, data)
    console.log(`Wrote ${outputPath}`)
  }

exporter.parse(scene, handleExport, console.error, { binary: true })
