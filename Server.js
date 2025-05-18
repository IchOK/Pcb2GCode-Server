/**
 * Node.js Webserver für CNC-Projektverwaltung
 * - Stellt statische Dateien aus "www" bereit
 * - Erstellt Sessions mit SessionHandler
 * - WebSocket-Endpunkt für Projekt-Kommunikation
 * - Download- und Upload-Endpunkte
 */

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const multer = require("multer");
const fs = require("fs");

const SessionHandler = require("./SessionHandler");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const sessionHandler = new SessionHandler();

// === Middleware für JSON-Parsing ===
app.use(express.json());

// === Upload-Handling ===
const upload = multer({ dest: path.join(__dirname, "uploads") });

/**
 * Session-Erstellung bei jedem neuen Besucher.
 * Gibt die Session-ID als JSON zurück.
 */
app.get("/api/session", (req, res) => {
  const sessionId = sessionHandler.createSession();
  res.json({ sessionId });
});

/**
 * Upload-Endpunkt für Gerber-Dateien.
 * Erwartet eine Datei im Feld "file" und eine gültige Session-ID.
 */
app.post("/api/upload", upload.single("file"), async (req, res) => {
  const sessionId = req.headers["x-session-id"] || req.body.sessionId;
  const session = sessionHandler.getSession(sessionId);
  if (!session) {
    return res.status(401).json({
      type: "uploadGerber",
      status: "error",
      msg: "Ungültige Session",
      data: null
    });
  }
  try {
    const result = await session.uploadGerber(req.file.path);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      type: "uploadGerber",
      status: "error",
      msg: err.message,
      data: null
    });
  }
});

/**
 * Download-Endpunkt für GCode-Archive.
 * Erwartet sessionId, gerberVersion und gcodeVersion als Query-Parameter.
 */
app.get("/api/download", async (req, res) => {
  const { sessionId, gerberVersion, gcodeVersion } = req.query;
  const session = sessionHandler.getSession(sessionId);
  if (!session) {
    return res.status(401).json({
      type: "downloadGCode",
      status: "error",
      msg: "Ungültige Session",
      data: null
    });
  }
  try {
    const result = await session.downloadGCode(Number(gerberVersion), Number(gcodeVersion));
    const downloadDir = path.join(__dirname, "downloads");
    const zipFile = `${session.projectName}_gcodeV${gerberVersion}.${gcodeVersion}.zip`;
    const zipFilePath = path.join(downloadDir, zipFile);
    res.download(zipFilePath, zipFile);
  } catch (err) {
    res.status(500).json({
      type: "downloadGCode",
      status: "error",
      msg: err.msg,
      data: null
    });
  }
});

app.post("/api/:action", async (req, res) => {
  const action = req.params.action;
  const sessionId = req.headers["x-session-id"] || req.body.sessionId;
  const session = sessionHandler.getSession(sessionId);

  if (!session) {
    return res.status(401).json({
      type: action,
      status: "error",
      msg: "Ungültige Session",
      data: null,
    });
  }

  // Message-Objekt bauen (alle Body-Parameter übernehmen)
  const message = {
    type: action,
    ...req.body,
  };

  try {
    // handleRequest erwartet einen JSON-String
    session.handleRequest(JSON.stringify(message))
      .then((response) => {
        // Antwort an den Client senden
        res.json({
          type: action,
          status: "ok",
          msg: response.msg,
          data: response.data,
        });
      })
      .catch((err) => {
        res.status(500).json({
          type: action,
          status: "error",
          msg: err.msg,
          data: err.data,
        });
      });
  } catch (err) {
    res.status(500).json({
      type: action,
      status: "error",
      msg: err.message,
      data: null,
    });
  }
});

// === WebSocket-Endpunkt ===
wss.on("connection", (ws, req) => {
  // Session-ID aus Query holen
  const url = new URL(req.url, `http://${req.headers.host}`);
  const sessionId = url.searchParams.get("sessionId");
  const session = sessionHandler.getSession(sessionId);

  if (!session) {
    ws.send(JSON.stringify({ 
      type: "connection",
      status: "error",
      msg: "Ungültige Session",
      data: null
    }));
    ws.close();
    return;
  }

  // WebSocket-Referenz setzen
  session.setWebSocket(ws);

  ws.on("message", async (message) => {
    try {
      await session.handleRequest(message);
    } catch (err) {
      ws.send(JSON.stringify({ 
        type: "request",
        status: "error", 
        msg: err.message,
        data: null
      }));
    }
  });

  ws.on("close", () => {
    session.setWebSocket(null);
  });
});

const WWW_DIR = path.join(__dirname, "www");

// === IndexV2.html für Root-Route bereitstellen ===
app.get("/", (req, res) => {
  res.sendFile(path.join(WWW_DIR, "indexV2.html"));
});

// === Statische Dateien bereitstellen ===
app.use(express.static(WWW_DIR));

// === Server starten ===
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});