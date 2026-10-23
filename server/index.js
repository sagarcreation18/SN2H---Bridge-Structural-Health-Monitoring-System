import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
import { Monitor } from "./service.js";
import { routes } from "./routes.js";
import { migrateFeatures } from "./feature-db.js";
import { identify, authRoutes } from "./auth.js";
import { featureRoutes } from "./feature-routes.js";
import { Notifications } from "./notifications.js";
import { DemoRunner } from "./demo.js";
import { AdvancedWorker } from "./advanced-worker.js";
import { advancedRoutes, auditMiddleware } from "./advanced-routes.js";
import { equal } from "./auth.js";
if (
  !process.env.ADMIN_TOKEN ||
  process.env.ADMIN_TOKEN.length < 24 ||
  !process.env.DEVICE_TOKEN ||
  process.env.DEVICE_TOKEN.length < 24
)
  throw new Error(
    "Set distinct ADMIN_TOKEN and DEVICE_TOKEN (24+ characters) in .env",
  );
if (process.env.ADMIN_TOKEN === process.env.DEVICE_TOKEN)
  throw new Error("Admin and device tokens must differ");
const app = express(),
  server = createServer(app),
  io = new Server(server, { maxHttpBufferSize: 10000 });
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "script-src": ["'self'"],
        "style-src": ["'self'"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'", "ws:", "wss:"],
      },
    },
  }),
);
app.use(express.json({ limit: "64kb" }));
app.use("/api", rateLimit({ windowMs: 60000, limit: 600 }));
const monitor = new Monitor(io);
await migrateFeatures();
await monitor.init();
const notifications = new Notifications(),
  demo = new DemoRunner(monitor);
monitor.notifications = notifications;
monitor.demo = demo;
notifications.start();
const advancedWorker = new AdvancedWorker(notifications);
advancedWorker.start();
app.use("/api", identify);
app.use("/api", auditMiddleware);
app.use("/api/auth", (req, res, next) => {
  res.on("finish", () => {
    if (
      res.statusCode < 300 &&
      ["/api/auth/logout", "/api/auth/password"].includes(
        req.originalUrl.split("?")[0],
      ) &&
      req.user
    )
      for (const socket of io.sockets.sockets.values())
        if (socket.request.user?.id === req.user.id) socket.disconnect(true);
  });
  next();
});
app.use("/api/auth", authRoutes());
app.use("/api", (req, res, next) => {
  if (
    process.env.REQUIRE_SIGN_IN !== "true" ||
    ["/health", "/remote/batch", "/sensor-data"].includes(req.path) ||
    req.user ||
    equal(
      req.headers.authorization?.replace(/^Bearer /, ""),
      process.env.ADMIN_TOKEN,
    )
  )
    return next();
  res.status(401).json({ error: "Sign in to view monitoring data" });
});
app.use("/api", advancedRoutes(monitor, notifications, advancedWorker));
app.use("/api", featureRoutes(monitor, notifications, demo));
app.use("/api", routes(monitor));
const base = fileURLToPath(new URL("../", import.meta.url));
app.use(
  "/vendor/bootstrap",
  express.static(base + "node_modules/bootstrap/dist"),
);
app.use("/vendor/chart", express.static(base + "node_modules/chart.js/dist"));
app.use("/vendor/fonts", express.static(base + "node_modules/@fontsource"));
app.use(
  "/vendor/icons",
  express.static(base + "node_modules/bootstrap-icons/font"),
);
app.use(express.static(base + "public"));
app.use("/api", (req, res) =>
  res.status(404).json({ error: "Endpoint not found" }),
);
app.use((err, req, res, next) => {
  console.error(err.message);
  res
    .status(err.status || (err.type === "entity.parse.failed" ? 400 : 500))
    .json({
      error: err.status
        ? err.message
        : err.type === "entity.parse.failed"
          ? "Invalid JSON"
          : "Server error; check database connectivity and server logs",
    });
});
io.use((socket, next) =>
  identify(socket.request, {}, (error) => {
    if (error) return next(error);
    if (process.env.REQUIRE_SIGN_IN === "true" && !socket.request.user)
      return next(new Error("Sign in to receive live data"));
    next();
  }),
);
io.on("connection", (socket) => {
  const expiryCheck = setInterval(async () => {
    if (process.env.REQUIRE_SIGN_IN !== "true") return;
    try {
      await identify(socket.request, {}, () => {});
      if (!socket.request.user) socket.disconnect(true);
    } catch {
      socket.disconnect(true);
    }
  }, 60000);
  socket.on("disconnect", () => clearInterval(expiryCheck));
  socket.emit("simulation:status", monitor.sim);
  socket.emit("settings:update", monitor.settings);
  socket.emit("demo:status", demo.snapshot());
});
server.listen(
  Number(process.env.PORT || 3100),
  process.env.HOST || "127.0.0.1",
  async () => {
    console.log(`SN²H monitor: http://localhost:${process.env.PORT || 3100}`);
    if (monitor.settings.autoStart)
      await monitor.control("start").catch((e) => console.error(e.message));
  },
);
async function shutdown() {
  monitor.close();
  notifications.close();
  demo.close();
  advancedWorker.close();
  io.close();
  server.close();
  await pool.end();
  process.exit();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
