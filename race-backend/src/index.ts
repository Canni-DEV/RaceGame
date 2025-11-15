import express from "express";
import http from "http";
import { PORT } from "./config";
import { GameLoop } from "./game/GameLoop";
import { RoomManager } from "./game/RoomManager";
import { SocketServer } from "./net/SocketServer";

const app = express();

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const httpServer = http.createServer(app);
const roomManager = new RoomManager();
const socketServer = new SocketServer(httpServer, roomManager);
const gameLoop = new GameLoop(roomManager, (roomId, state) => {
  socketServer.broadcastState(roomId, state);
});

gameLoop.start();

httpServer.listen(PORT, () => {
  console.log(`Game server running at http://localhost:${PORT}`);
});

process.on("SIGINT", () => {
  console.log("Shutting down...");
  gameLoop.stop();
  httpServer.close(() => process.exit(0));
});
