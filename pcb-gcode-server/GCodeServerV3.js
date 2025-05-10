const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const unzipper = require("unzipper");
const { exec } = require("child_process");
const archiver = require("archiver"); // Archiver-Bibliothek hinzufügen

// Erstelle einen Express Server
const app = express();
const port = 3000;

// Middleware zum Parsen von URL-encoded Daten (z. B. aus Formularen)
app.use(express.urlencoded({ extended: true }));

// Ordner für Uploads und Projekte
const uploadDir = "uploads";
const projectsDir = "projects";
const gcodeDir = "gcode";
const downloadDir = "downloads";

// Stelle sicher, dass die Ordner existieren
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir);
if (!fs.existsSync(gcodeDir)) fs.mkdirSync(gcodeDir);
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);

// Konfiguriere Multer für Datei-Uploads
const upload = multer({ dest: uploadDir });

const configPath = path.join(__dirname, "config.json");

//##################################################################################
// Main Webseite
//##################################################################################
app.get("/", (req, res) => {
  const projects = fs.readdirSync(projectsDir).filter((file) => fs.statSync(path.join(projectsDir, file)).isDirectory());
  const projectOptions = projects.map((project) => `<option value="${project}">${project}</option>`).join("");

  res.send(`
        <h1>ZIP-Dateien hochladen</h1>
        <form action="/upload" method="post" enctype="multipart/form-data">
            <input type="file" name="zipFile" />
            <input type="submit" value="Upload" />
        </form>
        <h1>Projekte</h1>
        <form action="/run-pcb2gcode" method="post">
            <select name="project">
                ${projectOptions}
            </select>
            <button type="submit">Convert</button>
        </form>
    `);
});

//##################################################################################
// File Upload
// - Web-Endpunkt für File-Uploads
// - Entpackt die ZIP-Datei in den Projekte-Ordner
// - Kombiniert die Drill-Dateien mit Werkzeuganpassung
//##################################################################################
app.post("/upload", upload.single("zipFile"), (req, res) => {
  const zipFile = req.file;

  if (!zipFile) {
    return res.status(400).send("Keine Datei hochgeladen.");
  }

  const zipFilePath = path.join(__dirname, zipFile.path);
  const outputFolder = path.join(projectsDir, path.parse(zipFile.originalname).name);

  // Erstelle den Zielordner
  if (fs.existsSync(outputFolder)) {
    fs.rmSync(outputFolder, { recursive: true, force: true });
  }
  fs.mkdirSync(outputFolder, { recursive: true });

  // Entpacke die ZIP-Datei
  fs.createReadStream(zipFilePath)
    .pipe(unzipper.Extract({ path: outputFolder }))
    .on("close", () => {
      console.log("ZIP-Datei entpackt:", outputFolder);

      // Lösche die hochgeladene ZIP-Datei
      fs.unlinkSync(zipFilePath);

      // Kombiniere die Drill-Dateien mit Werkzeuganpassung
      combineDrillFilesWithTools(outputFolder);

      res.send(`
                <h1>ZIP-Datei erfolgreich hochgeladen und entpackt!</h1>
                <p>Entpackt in: ${outputFolder}</p>
                <p>Drill-Dateien kombiniert in: Drill_Total.DRL</p>
                <a href="/">Zurück</a>
            `);
    })
    .on("error", (err) => {
      console.error("Fehler beim Entpacken:", err);
      res.status(500).send("Fehler beim Entpacken der ZIP-Datei.");
    });
});

//##################################################################################
// PCB2GCode Konvertierung
// - 
//##################################################################################
app.post("/run-pcb2gcode", (req, res) => {
  const project = req.body.project;

  if (!project) {
    return res.status(400).send("Kein Projekt ausgewählt.");
  }

  const projectPath = path.resolve(__dirname, projectsDir, project);
  const gcodePath = path.resolve(__dirname, gcodeDir, project);
  const zipFilePath = path.resolve(__dirname, downloadDir, `${project}.zip`);

  // Stelle sicher, dass das gcode-Verzeichnis existiert
  if (!fs.existsSync(gcodePath)) {
    fs.mkdirSync(gcodePath, { recursive: true });
  }

  // Lade die Konfigurationsdatei
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (err) {
    console.error("Fehler beim Laden der Konfigurationsdatei:", err);
    return res.status(500).send("Fehler beim Laden der Konfigurationsdatei.");
  }

  // Baue das Kommando dynamisch zusammen
  const pcb2gcodeConfig = config.pcb2gcode;
  pcb2gcodeConfig.back = path.resolve(projectPath, "Gerber_BottomLayer.GBL");
  pcb2gcodeConfig.drill = path.resolve(projectPath, "Drill_Total.DRL");
  pcb2gcodeConfig.outline = path.resolve(projectPath, "Gerber_BoardOutlineLayer.GKO");
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
      return res.status(500).send("Fehler beim Ausführen des Befehls.");
    }

    console.log(`Befehl ausgeführt: ${stdout}`);

    // Zippe die Dateien im gcodePath
    const output = fs.createWriteStream(zipFilePath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      console.log(`ZIP-Datei erstellt: ${zipFilePath}`);
      res.send(`
        <h1>Befehl erfolgreich ausgeführt</h1>
        <p>ZIP-Datei erstellt: <a href="/downloads/${project}.zip">${project}.zip</a></p>
        <pre>${stdout}</pre>
        <a href="/">Zurück</a>
      `);
    });

    archive.on("error", (err) => {
      console.error("Fehler beim Erstellen der ZIP-Datei:", err);
      res.status(500).send("Fehler beim Erstellen der ZIP-Datei.");
    });

    archive.pipe(output);
    archive.directory(gcodePath, false); // Füge alle Dateien im gcodePath hinzu
    archive.finalize();
  });
});

//##################################################################################
// Kombiniere Drill-Dateien mit Werkzeuganpassung
// - Liest alle DRL-Dateien im Projektverzeichnis
// - Extrahiert die Werkzeugnummern und Durchmesser
// - Kombiniert die Bohrungen in einer neuen Datei
//##################################################################################
const combineDrillFilesWithTools = (outputFolder) => {
  const drillFiles = fs.readdirSync(outputFolder).filter((file) => file.endsWith(".DRL"));
  const combinedFilePath = path.join(outputFolder, "Drill_Total.DRL");

  const globalDrills = new Map(); // Map für Bohrung mit Durchmesser

  drillFiles.forEach((file) => {
    console.log(`Found File: ${file}`);
    const filePath = path.join(outputFolder, file);
    const lines = fs.readFileSync(filePath, "utf-8").split("\n");

    let currentDiameter = null;
    const localTools = new Map(); // Toolnamen und Durchmesser

    lines.forEach((line) => {
      // Werkzeugdefinitionen (z.B. T01C3.101)
      const toolMatch = line.match(/^T(\d+)C([\d.]+)/);
      if (toolMatch) {
        const [, toolNumber, diameter] = toolMatch;
        console.log(` - Found Tool: No=${toolNumber} Dia=${diameter}`);
        // Werkzeug in Map speichern, wenn es noch nicht vorhanden ist
        localTools.set(toolNumber, diameter);
        return;
      }

      // Werkzeugverwendung (z.B. T01)
      const usageMatch = line.match(/^T(\d+)/);
      if (usageMatch) {
        const [, toolNumber] = usageMatch;
        console.log(` - Found Usage: Tool=${toolNumber}`);
        currentDiameter = localTools.get(toolNumber);
        return;
      }

      // Koordinatenzeilen (z.B. X081280Y003810)
      if (currentDiameter && line.startsWith("X")) {
        if (globalDrills.has(line)) {
          if (globalDrills.get(line) < currentDiameter) {
            console.log(`   - Update Drill: ${line} from ${globalDrills.get(line)} to ${currentDiameter}`);
            globalDrills.set(line, currentDiameter);
          } else {
            console.log(`   - Skip Drill: ${line} with ${globalDrills.get(line)}`);
          }
        } else {
          globalDrills.set(line, currentDiameter);
        }
      }
    });
  });

  // Bohrungen in Tools zusammen fassen
  const globalTools = new Map(); // Map für Durchmesser, mit Bohrungen
  globalDrills.forEach((diameter, drill) => {
    if (!globalTools.has(diameter)) {
      globalTools.set(diameter, []);
    }
    globalTools.get(diameter).push(drill);
  });

  // Schreibe die kombinierte Datei
  const writeStream = fs.createWriteStream(combinedFilePath);

  // Kopf mit Werkzeugdefinitionen
  writeStream.write("M48\n");
  writeStream.write("METRIC,LZ,000.000\n");
  let toolNumber = 1;
  globalTools.forEach((value, key) => {
    const formattedToolNumber = String(toolNumber).padStart(2, "0"); // Zweistellige Werkzeugnummer
    writeStream.write(`T${formattedToolNumber}C${key}\n`);
    toolNumber++;
  });
  writeStream.write("%\nG05\nG90\n");

  // Werkzeugverwendungen
  toolNumber = 1;
  globalTools.forEach((value, key) => {
    const formattedToolNumber = String(toolNumber).padStart(2, "0"); // Zweistellige Werkzeugnummer
    writeStream.write(`T${formattedToolNumber}\n`);
    value.forEach((usage) => {
      writeStream.write(`${usage}\n`);
    });
    toolNumber++;
  });

  writeStream.end();
  console.log(`Drill-Dateien kombiniert in: ${combinedFilePath}`);
};



// Starte den Server
app.listen(port, () => {
  console.log(`Server läuft auf http://localhost:${port}`);
});
