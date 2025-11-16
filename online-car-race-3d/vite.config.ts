import { defineConfig } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

function resolveHttpsConfig() {
  const certDir = path.resolve(__dirname, '../cert')
  const certPath = path.join(certDir, 'localhost+3.pem')
  const keyPath = path.join(certDir, 'localhost+3-key.pem')
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
    }
  }
  return undefined
}

export default defineConfig({
  base: '/RaceGame/online-car-race-3d/',
  server: {
    host: '0.0.0.0',
    port: 5173,
    https: resolveHttpsConfig(),
  },
})
