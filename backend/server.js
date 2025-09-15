import express from "express";
import { spawn, exec } from "child_process";
import fs from "fs";
import cors from "cors";
import path from "path";

const app = express();
app.use(express.json());
app.use(cors());

const __dirname = path.resolve();

// Helper: wrap async routes to catch errors
const safeHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Global error handler
app.use((err, req, res, next) => {
  console.error("💥 Uncaught error:", err);
  res.status(500).json({ error: "Internal server error" });
});

/* ========== Disk Listing ========== */
app.get(
  "/api/disks",
  safeHandler(async (req, res) => {
    exec("lsblk -o NAME,SIZE,TYPE,MOUNTPOINT -J", (err, stdout) => {
      if (err) return res.status(500).json({ error: "lsblk failed" });
      try {
        const data = JSON.parse(stdout);
        const disks = data.blockdevices.filter(
          (d) =>
            d.type === "disk" && !d.name.startsWith("loop") && !d.name.startsWith("sr")
        );
        res.json({ disks });
      } catch {
        res.status(500).json({ error: "parse error" });
      }
    });
  })
);

/* ========== Disk Wipe ========== */
let currentWipe = null;

app.post(
  "/api/wipe",
  safeHandler(async (req, res) => {
    const { device, method, sudoPassword } = req.body;
    if (!device || !method || !sudoPassword)
      return res.status(400).json({ error: "Missing fields" });

    currentWipe = { device, method, sudoPassword };
    fs.writeFileSync("current_wipe.json", JSON.stringify(currentWipe, null, 2));
    res.json({ message: "Wipe queued" });
  })
);

app.get("/api/wipe-progress", (req, res) => {
  if (!currentWipe) return res.status(400).end("No wipe running");

  const { device, method, sudoPassword } = currentWipe;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const wipeMethod = method === "random" ? "2" : "1";
    const child = spawn("sudo", ["-S", "./wiper", device, wipeMethod], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: __dirname,
    });

    child.stdin.write(sudoPassword + "\n");
    child.stdin.end();

    child.stdout.on("data", (chunk) => {
      const lines = chunk.toString().split(/\r?\n/);
      lines.forEach((line) => {
        const m = line.match(/PROGRESS:(\d+)/);
        if (m) {
          res.write(`data: ${m[1]}\n\n`);
          fs.writeFileSync(
            "wipe_log.json",
            JSON.stringify({ progress: m[1] }, null, 2)
          );
        }
      });
    });

    child.stderr.on("data", (d) => console.error("Wiper stderr:", d.toString()));

    child.on("exit", () => {
      try {
        const cert = fs.existsSync("wipe_log.json")
          ? JSON.parse(fs.readFileSync("wipe_log.json"))
          : { status: "UNKNOWN" };
        res.write(`data: 100\n\n`);
        res.write(`event: done\ndata: ${JSON.stringify(cert)}\n\n`);
      } catch (err) {
        res.write(
          `event: done\ndata: ${JSON.stringify({ status: "FAILED" })}\n\n`
        );
      }
      res.end();
      currentWipe = null;
    });
  } catch (err) {
    console.error("Spawn error:", err);
    res.end();
    currentWipe = null;
  }
});

/* ========== Factory Reset ========== */
let currentFactory = null;

app.post(
  "/api/factory-reset",
  safeHandler(async (req, res) => {
    const { sudoPassword } = req.body;
    if (!sudoPassword) return res.status(400).json({ error: "Missing sudoPassword" });

    currentFactory = { sudoPassword };
    fs.writeFileSync("current_factory.json", JSON.stringify(currentFactory, null, 2));
    res.json({ message: "Factory reset queued" });
  })
);

app.get("/api/factory-progress", (req, res) => {
  if (!currentFactory) return res.status(400).end("No factory reset running");

  const { sudoPassword } = currentFactory;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const child = spawn("sudo", ["-S", "./factoryreset"], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: __dirname,
    });

    child.stdin.write(sudoPassword + "\n");
    child.stdin.write("y\n");
    child.stdin.end();

    child.stdout.on("data", (chunk) => {
      const lines = chunk.toString().split(/\r?\n/);
      lines.forEach((line) => {
        const m = line.match(/PROGRESS:(\d+)/);
        if (m) {
          res.write(`data: ${m[1]}\n\n`);
          fs.writeFileSync(
            "factory_log.json",
            JSON.stringify({ progress: m[1] }, null, 2)
          );
        }
      });
    });

    child.stderr.on("data", (d) => console.error("Factory stderr:", d.toString()));

    child.on("exit", () => {
      try {
        const cert = fs.existsSync("factory_log.json")
          ? JSON.parse(fs.readFileSync("factory_log.json"))
          : { status: "UNKNOWN" };
        res.write(`data: 100\n\n`);
        res.write(`event: done\ndata: ${JSON.stringify(cert)}\n\n`);
      } catch {
        res.write(
          `event: done\ndata: ${JSON.stringify({ status: "FAILED" })}\n\n`
        );
      }
      res.end();
      currentFactory = null;
    });
  } catch (err) {
    console.error("Spawn error:", err);
    res.end();
    currentFactory = null;
  }
});

/* ========== Test endpoint ========== */
app.get("/api/test", (req, res) => res.send("Backend alive!"));

// Start server safely
const PORT = 5000;
app.listen(PORT, () => console.log(`✅ Backend running at http://localhost:${PORT}`));
