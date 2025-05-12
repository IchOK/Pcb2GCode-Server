const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const unzipper = require("unzipper");
const { exec } = require("child_process");
const archiver = require("archiver");
const https = require("https"); // HTTPS-Modul hinzufügen
const { saveLastProject, loadLastProject, combineDrillFilesWithTools, mergeMillingFiles } = require("./ServerScripts.js");

// SSL-Zertifikat und Schlüssel laden
const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, "key.pem")), // Pfad zur Schlüsseldatei
  cert: fs.readFileSync(path.join(__dirname, "cert.pem")), // Pfad zur Zertifikatsdatei
};

// Erstelle einen Express Server
const app = express();
const port = 3000;

// Statische Dateien aus dem "www"-Verzeichnis bereitstellen
const wwwDir = path.join(__dirname, "www");
app.use(express.static(wwwDir));

// Middleware zum Parsen von URL-encoded Daten (z. B. aus Formularen)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Ordner für Uploads und Projekte
const uploadDir = "uploads";
const downloadDir = "downloads";
const projectsDir = "projects";

const gerberSubDir = "gerber";
const gcodeSubDir = "gcode";

// Stelle sicher, dass die Ordner existieren
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);
if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir);

// Konfiguriere Multer für Datei-Uploads
const upload = multer({ dest: uploadDir });

const configPath = path.join(__dirname, "config.json");

//##################################################################################
// Main Webseite
//##################################################################################
app.get("/", (req, res) => {
  res.sendFile(path.join(wwwDir, "index.html"));
});

//##################################################################################
// Projekt erstellen
//##################################################################################
app.post("/create-project", express.json(), (req, res) => {
  const newProject = req.body.project?.trim();

  if (!newProject) {
    return res.json({ success: false, message: "Projektname darf nicht leer sein." });
  }

  const projectPath = path.join(projectsDir, newProject);

  if (fs.existsSync(projectPath)) {
    return res.json({ success: false, message: "Projekt existiert bereits." });
  }

  try {
    fs.mkdirSync(projectPath, { recursive: true });
    fs.copyFileSync(configPath, path.join(projectPath, "config.json"));
    saveLastProject(newProject);

    return res.json({ success: true, message: "Projekt erfolgreich erstellt!" });
  } catch (err) {
    return res.json({ success: false, message: "Fehler beim Erstellen des Projekts.\n" + err });
  }
});

//##################################################################################
// Projekte abfragen
//##################################################################################
app.get("/get-projects", (req, res) => {
  try {
    const projects = fs.readdirSync(projectsDir).filter((file) => fs.statSync(path.join(projectsDir, file)).isDirectory());

    const lastProject = loadLastProject();

    res.json({ success: true, projects, lastProject });
  } catch (err) {
    res.json({ success: false, error: "Fehler beim Abrufen der Projekte.\n" + err });
  }
});

//##################################################################################
// Projekt auswählen
//##################################################################################
app.post("/select-project", express.json(), (req, res) => {
  const project = req.body.project;

  if (!project) {
    return res.json({ success: false, message: "Kein Projekt ausgewählt." });
  }

  const projectPath = path.join(projectsDir, project);

  if (!fs.existsSync(projectPath)) {
    return res.json({ success: false, message: "Projekt existiert nicht." });
  }

  try {
    saveLastProject(project);

    return res.json({ success: true, message: "Projekt ausgewählt" });
  } catch (err) {
    return res.json({ success: false, message: "Fehler beim Auswählen des Projekts.\n" + err });
  }
});

//##################################################################################
// File Upload
// - Web-Endpunkt für File-Uploads
// - Entpackt die ZIP-Datei in den Projekte-Ordner
// - Kombiniert die Drill-Dateien mit Werkzeuganpassung
//##################################################################################
app.post("/upload", upload.single("zipFile"), (req, res) => {
  const zipFile = req.file;
  const project = loadLastProject();

  if (!project) {
    return res.json({ success: false, message: "Kein Projekt ausgewählt." });
  }

  if (!zipFile) {
    return res.json({ success: false, message: "Keine Datei hochgeladen." });
  }

  const projectPath = path.join(projectsDir, project);
  const gerberPath = path.join(projectPath, gerberSubDir);
  const zipFilePath = path.join(__dirname, zipFile.path);

  // Erstelle den Gerber-Ordner neu
  if (fs.existsSync(gerberPath)) {
    fs.rmSync(gerberPath, { recursive: true, force: true });
  }
  fs.mkdirSync(gerberPath, { recursive: true });

  // Entpacke die ZIP-Datei
  fs.createReadStream(zipFilePath)
    .pipe(unzipper.Extract({ path: gerberPath }))
    .on("close", () => {
      // Lösche die hochgeladene ZIP-Datei
      fs.unlinkSync(zipFilePath);

      // Kombiniere die Drill-Dateien mit Werkzeuganpassung
      combineDrillFilesWithTools(gerberPath);

      // Zeige ein Popup und leite zur Hauptseite weiter
      return res.json({ success: true, message: "Gerber ZIP erfolgreich hochgeladen und entpackt!" });
    })
    .on("error", (err) => {
      return res.json({ success: false, message: "Fehler beim Upload der Gerber ZIP.\n" + err });
    });
});

//##################################################################################
// Konfiguration bearbeiten
// - Web-Endpunkt für die Bearbeitung der config.json
//##################################################################################
app.get("/edit-config", (req, res) => {
  const htmlPath = path.join(__dirname, "www", "edit.html");
  res.sendFile(htmlPath);
});

//##################################################################################
// Daten aus dem config.json abrufen
//##################################################################################
app.get("/get-config", (req, res) => {
  const configPath = req.query.configPath;

  if (!configPath) {
    return res.status(400).json({ error: "Kein Konfigurationspfad angegeben." });
  }

  const absolutPath = path.join(__dirname, configPath);

  if (!fs.existsSync(absolutPath)) {
    return res.status(404).json({ error: "Die Konfigurationsdatei wurde nicht gefunden." });
  }

  try {
    const config = JSON.parse(fs.readFileSync(absolutPath, "utf-8"));
    res.json({ success: true, config });
  } catch (err) {
    console.error("Fehler beim Laden der Konfigurationsdatei:", err);
    res.status(500).json({ error: "Fehler beim Laden der Konfigurationsdatei." });
  }
});

//##################################################################################
// Daten aus dem config.json abrufen
//##################################################################################
app.post("/get-configV2", express.json(), (req, res) => {
  const { projectName, global } = req.body;

  let absolutPath = "";
  if (global) {
    // Hier können Sie die globalen Konfigurationen zurückgeben
    absolutPath = path.join(__dirname, "config.json");
  } else {
    // Hier können Sie die spezifischen Konfigurationen zurückgeben
    if (!projectName) {
      return res.json({ success: false, message: "Kein Projektname angegeben." });
    }
    absolutPath = path.join(__dirname, projectsDir, projectName, "config.json");
  }

  if (!fs.existsSync(absolutPath)) {
    return res.json({ success: false, message: "Die Konfigurationsdatei wurde nicht gefunden." });
  }
  try {
    const config = JSON.parse(fs.readFileSync(absolutPath, "utf-8"));
    res.json({ success: true, config });
  } catch (err) {
    console.error("Fehler beim Laden der Konfigurationsdatei:", err);
    return res.json({ success: false, message: "Fehler beim Laden der Konfigurationsdatei." });
  }
});

//##################################################################################
// Speichern der Änderungen an der config.json
//##################################################################################
app.post("/save-config", express.json(), (req, res) => {
  const configPath = req.body.path; // Der Pfad zur Konfigurationsdatei
  const configData = req.body.config; // Die Konfigurationsdaten im JSON-Format

  if (!configPath) {
    return res.status(400).json({ success: false, message: "Kein Konfigurationspfad angegeben." });
  }

  if (!configData || typeof configData !== "object") {
    return res.status(400).json({ success: false, message: "Ungültige Konfigurationsdaten." });
  }

  const absolutPath = path.join(__dirname, configPath);

  // Speichere die Konfigurationsdaten
  try {
    const config = { pcb2gcode: configData }; // Verpacke die Daten in das erwartete Format
    fs.writeFileSync(absolutPath, JSON.stringify(config, null, 2), "utf-8");
    console.log(`Konfigurationsdatei aktualisiert: ${absolutPath}`);
    return res.json({ success: true, message: "Speichern erfolgreich!" });
  } catch (err) {
    console.error("Fehler beim Speichern der Konfigurationsdatei:", err);
    return res.status(500).json({ success: false, message: "Fehler beim Speichern der Konfigurationsdatei." });
  }
});

//##################################################################################
// Speichern der Änderungen an der config.json
//##################################################################################
app.post("/save-configV2", express.json(), (req, res) => {
  const { projectName, global , config} = req.body;

  let absolutPath = "";
  if (global) {
    // Hier können Sie die globalen Konfigurationen zurückgeben
    absolutPath = path.join(__dirname, "config.json");
  } else {
    // Hier können Sie die spezifischen Konfigurationen zurückgeben
    if (!projectName) {
      return res.json({ success: false, message: "Kein Projektname angegeben." });
    }
    absolutPath = path.join(__dirname, projectsDir, projectName, "config.json");
  }

  if (!config || typeof config !== "object") {
    return res.status(400).json({ success: false, message: "Ungültige Konfigurationsdaten." });
  }

  // Speichere die Konfigurationsdaten
  try {
    fs.writeFileSync(absolutPath, JSON.stringify(config, null, 2), "utf-8");
    console.log(`Konfigurationsdatei aktualisiert: ${absolutPath}`);
    return res.json({ success: true, message: "Speichern erfolgreich!" });
  } catch (err) {
    console.error("Fehler beim Speichern der Konfigurationsdatei:", err);
    return res.json({ success: false, message: "Fehler beim Speichern der Konfigurationsdatei." });
  }
});

//##################################################################################
// PCB2GCode Konvertierung
// - Web-Endpunkt für die Konvertierung von Gerber-Dateien in G-Code
// - Führt pcb2gcode mit den konfigurierten Optionen aus
// - Erstellt eine ZIP-Datei mit den G-Code-Dateien
//##################################################################################
app.post("/run-pcb2gcode", (req, res) => {
  const project = loadLastProject();

  if (!project) {
    return res.json({ success: false, message: "Kein Projekt ausgewählt." });
  }

  const projectPath = path.resolve(__dirname, projectsDir, project);
  const gerberPath = path.resolve(projectPath, gerberSubDir);
  const gcodePath = path.resolve(projectPath, gcodeSubDir);
  const projectConfigPath = path.join(projectPath, "config.json");

  if (!fs.existsSync(gerberPath)) {
    return res.json({ success: false, message: "Gerber Dateien existieren nicht, zuerst Hochladen." });
  }

  // Stelle sicher, dass das gcode-Verzeichnis existiert
  if (!fs.existsSync(gcodePath)) {
    fs.mkdirSync(gcodePath, { recursive: true });
  }

  // Lade die Konfigurationsdatei
  let config;
  try {
    config = JSON.parse(fs.readFileSync(projectConfigPath, "utf-8"));
  } catch (err) {
    console.error("Fehler beim Laden der Konfigurationsdatei:", err);
    return res.json({ success: false, message: "Fehler beim Laden der Konfigurationsdatei.\n" + err });
  }

  // Baue das Kommando dynamisch zusammen
  const pcb2gcodeConfig = config.pcb2gcode;
  pcb2gcodeConfig.back = path.resolve(gerberPath, "Gerber_BottomLayer.GBL");
  pcb2gcodeConfig.drill = path.resolve(gerberPath, "Drill_Total.DRL");
  pcb2gcodeConfig.outline = path.resolve(gerberPath, "Gerber_BoardOutlineLayer.GKO");
  pcb2gcodeConfig["output-dir"] = gcodePath;

  const commandParts = ["pcb2gcode"];
  for (const [key, value] of Object.entries(pcb2gcodeConfig)) {
    commandParts.push(`--${key}=${value}`);
  }
  const command = commandParts.join(" ");

  // Führe das Kommando aus
  exec(command, { cwd: projectPath }, (error, stdout, stderr) => {
    if (error) {
      console.error(`Fehler beim Ausführen des Befehls: ${error.message}`);
      return res.json({ success: false, message: "Fehler beim Ausführen des Befehls.\n" + error.message });
    }

    try {
      // Merge der G-Code-Dateien
      mergeMillingFiles(gcodePath);
      return res.json({ success: true, message: "Gerber erfolgreich in G-Code konverteirt." });
    } catch (err) {
      console.error("Fehler beim LMergen der G-Code FIles:", err);
      return res.json({ success: false, message: "Fehler beim Mergen der G-Code FIles.\n" + err });
    }
  });
});

//##################################################################################
// ZIP-Datei herunterladen
//##################################################################################
app.get("/download-zip", (req, res) => {
  const project = loadLastProject();

  if (!project) {
    return res.json({ success: false, message: "Kein Projekt ausgewählt." });
  }

  const projectPath = path.resolve(__dirname, projectsDir, project);
  const gcodePath = path.resolve(projectPath, gcodeSubDir);
  const zipFile = `${project}.zip`;
  const zipFilePath = path.resolve(__dirname, downloadDir, zipFile);

  // Stelle sicher, dass das gcode-Verzeichnis existiert
  if (!fs.existsSync(gcodePath)) {
    return res.json({ success: false, message: "G-Code Dateien existiert nicht, zuerst Konvertieren." });
  }

  // Zippe die Dateien im gcodePath
  const output = fs.createWriteStream(zipFilePath);
  const archive = archiver("zip", { zlib: { level: 9 } });

  output.on("close", () => {
    console.log(`ZIP-Datei erstellt: ${zipFilePath}`);
    res.setHeader("Content-Disposition", `attachment; filename="${zipFile}"`);
    res.download(zipFilePath, (err) => {
      if (err) {
        console.error("Fehler beim Herunterladen der ZIP-Datei:", err);
        return res.status(500).json({ success: false, message: "Fehler beim Herunterladen der ZIP-Datei.\n" + err });
      } else {
        console.error("Download ohne Fehler");
      }
    });
  });

  archive.on("error", (err) => {
    console.error("Fehler beim Erstellen der ZIP-Datei:", err);
    return res.json({ success: false, message: "Fehler beim Erstellen der ZIP-Datei.\n" + err });
  });

  archive.pipe(output);
  archive.directory(gcodePath, false); // Füge alle Dateien im gcodePath hinzu
  archive.finalize();

  if (!fs.existsSync(zipFilePath)) {
    return res.json({ success: false, message: "Die ausgewählte ZIP-Datei wurde nicht gefunden." });
  }
});

// Starte den HTTPS-Server
https.createServer(sslOptions, app).listen(port, () => {
  console.log(`HTTPS-Server läuft auf https://localhost:${port}`);
});
