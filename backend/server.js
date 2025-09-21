// server.js
import express from "express";
import { spawn, exec } from "child_process";
import fs from "fs";
import path from "path";
import cors from "cors";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(cors());

// ========== Helpers ==========
const safeHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function writeLiveLog(filename, data) {
  fs.writeFileSync(filename, JSON.stringify(data, null, 2));
}

// ========== Serve live JSON logs ==========
app.use("/wipe_live.json", express.static(path.join(__dirname, "wipe_live.json")));
app.use("/factory_live.json", express.static(path.join(__dirname, "factory_live.json")));

// ========== Disk Listing ==========
app.get("/api/disks", safeHandler(async (req, res) => {
  exec("lsblk -o NAME,SIZE,TYPE,MOUNTPOINT -J", (err, stdout) => {
    if (err) return res.status(500).json({ error: "lsblk failed" });
    try {
      const data = JSON.parse(stdout);
      const disks = Array.isArray(data.blockdevices)
        ? data.blockdevices.filter(d => d.type === "disk" && !d.name.startsWith("loop") && !d.name.startsWith("sr"))
        : [];
      res.json({ disks });
    } catch (parseErr) {
      console.error("Disk parse error:", parseErr);
      res.status(500).json({ error: "parse error" });
    }
  });
}));

// ========== Disk Wipe ==========
let currentWipe = null;

app.post("/api/wipe", safeHandler(async (req, res) => {
  const { device, method, sudoPassword } = req.body;
  if (!device || !method || !sudoPassword) return res.status(400).json({ error: "Missing fields" });
  currentWipe = { device, method, sudoPassword };
  res.json({ message: "Wipe queued" });
}));

app.get("/api/wipe-progress", (req, res) => {
  if (!currentWipe) return res.status(400).end("No wipe running");

  const { device, method, sudoPassword } = currentWipe;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const wipeMethod = method === "random" ? "2" : "1";
    const child = spawn("sudo", ["-S", "./wiper", `/dev/${device}`, wipeMethod], {
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
          writeLiveLog("wipe_live.json", { progress: m[1], status: "IN_PROGRESS" });
        }
      });
    });

    child.stderr.on("data", (d) => console.error("Wiper stderr:", d.toString()));

    child.on("exit", () => {
      try {
        const finalCert = {
          mode: "Disk Wipe",
          device,
          method,
          status: "SUCCESS",
          timestamp: new Date().toISOString(),
        };
        writeLiveLog("wipe_live.json", finalCert);

        res.write(`data: 100\n\n`);
        res.write(`event: done\ndata: ${JSON.stringify(finalCert)}\n\n`);
      } catch (err) {
        console.error("Finalization error:", err);
        res.write(`event: done\ndata: ${JSON.stringify({ status: "FAILED" })}\n\n`);
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

// ========== Factory Reset ==========
let currentFactory = null;

app.post("/api/factory-reset", safeHandler(async (req, res) => {
  const { sudoPassword } = req.body;
  if (!sudoPassword) return res.status(400).json({ error: "Missing sudoPassword" });
  currentFactory = { sudoPassword };
  res.json({ message: "Factory reset queued" });
}));

app.get("/api/factory-progress", (req, res) => {
  if (!currentFactory) return res.status(400).end("No factory reset running");

  const { sudoPassword } = currentFactory;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const child = spawn("sudo", ["-S", "./factoryreset"], { stdio: ["pipe", "pipe", "pipe"], cwd: __dirname });
    child.stdin.write(sudoPassword + "\n");
    child.stdin.write("y\n");
    child.stdin.end();

    child.stdout.on("data", (chunk) => {
      const lines = chunk.toString().split(/\r?\n/);
      lines.forEach((line) => {
        const m = line.match(/PROGRESS:(\d+)/);
        if (m) {
          res.write(`data: ${m[1]}\n\n`);
          writeLiveLog("factory_live.json", { progress: m[1], status: "IN_PROGRESS" });
        }
      });
    });

    child.stderr.on("data", (d) => console.error("Factory stderr:", d.toString()));

    child.on("exit", () => {
      try {
        const finalCert = {
          mode: "Factory Reset",
          status: "SUCCESS",
          timestamp: new Date().toISOString(),
        };
        writeLiveLog("factory_live.json", finalCert);

        res.write(`data: 100\n\n`);
        res.write(`event: done\ndata: ${JSON.stringify(finalCert)}\n\n`);
      } catch (err) {
        console.error("Finalization error:", err);
        res.write(`event: done\ndata: ${JSON.stringify({ status: "FAILED" })}\n\n`);
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

// ========== Test ==========
app.get("/api/test", (req, res) => res.send("Backend alive!"));

// ========== Serve React Frontend ==========
const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));
app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

// ========== Start Server ==========
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
