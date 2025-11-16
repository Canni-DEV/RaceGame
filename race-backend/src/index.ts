import express from "express";
import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import { PORT } from "./config";
import { GameLoop } from "./game/GameLoop";
import { RoomManager } from "./game/RoomManager";
import { SocketServer } from "./net/SocketServer";

function resolveHttpsOptions(): https.ServerOptions | null {
  const rootDir = path.resolve(__dirname, "..", "..");
  const certDir = path.join(rootDir, "cert");
  const certPath = path.join(certDir, "localhost+3.pem");
  const keyPath = path.join(certDir, "localhost+3-key.pem");

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath)
    };
  }

  return null;
}

const app = express();

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const httpsOptions = resolveHttpsOptions();
const server = httpsOptions ? https.createServer(httpsOptions, app) : http.createServer(app);
const roomManager = new RoomManager();
const socketServer = new SocketServer(server, roomManager);
const gameLoop = new GameLoop(roomManager, (roomId, state) => {
  socketServer.broadcastState(roomId, state);
});

gameLoop.start();

const protocol = httpsOptions ? "https" : "http";
server.listen(PORT, () => {
  console.log(`Game server running at ${protocol}://localhost:${PORT}`);
});

process.on("SIGINT", () => {
  console.log("Shutting down...");
  gameLoop.stop();
  server.close(() => process.exit(0));
});
