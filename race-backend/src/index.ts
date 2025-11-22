import express from "express";
import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import { PORT, TRACK_ASSET_LIBRARY } from "./config";
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

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN ?? "*";

const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.header("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

if (fs.existsSync(TRACK_ASSET_LIBRARY.directory)) {
  app.use(TRACK_ASSET_LIBRARY.route, express.static(TRACK_ASSET_LIBRARY.directory));
} else {
  console.warn(
    `[Server] Asset directory "${TRACK_ASSET_LIBRARY.directory}" does not exist. GLB decorations will be skipped.`
  );
}

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
