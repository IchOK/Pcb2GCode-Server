const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const unzipper = require("unzipper");
const { exec } = require("child_process");
const archiver = require("archiver");
const https = require("https"); // HTTPS-Modul hinzufügen

// SSL-Zertifikat und Schlüssel laden
const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, "key.pem")), // Pfad zur Schlüsseldatei
  cert: fs.readFileSync(path.join(__dirname, "cert.pem")), // Pfad zur Zertifikatsdatei
};

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
  // Liste der Projekte im projectsDir
  const projects = fs.readdirSync(projectsDir).filter((file) => fs.statSync(path.join(projectsDir, file)).isDirectory());
  const projectOptions = projects.map((project) => `<option value="${project}">${project}</option>`).join("");

  // Liste der ZIP-Dateien im downloadsDir
  const zipFiles = fs.readdirSync(downloadDir).filter((file) => file.endsWith(".zip"));
  const zipFileOptions = zipFiles.map((file) => `<option value="${file}">${file}</option>`).join("");

  res.send(`
        <h1>ZIP-Dateien hochladen</h1>
        <form action="/upload" method="post" enctype="multipart/form-data">
            <input type="file" name="zipFile" />
            <input type="submit" value="Upload" />
        </form>
        <h1>Projekte</h1>
        <form action="/run-pcb2gcode" method="post" style="margin-bottom: 20px;">
            <select name="project" id="projectSelect">
                ${projectOptions}
            </select>
            <button type="submit">Convert</button>
        </form>
        <form action="/edit-config" method="get">
            <input type="hidden" name="configPath" id="configPathInput" />
            <button type="submit">Bearbeite Konfiguration</button>
        </form>
        <h1>ZIP-Dateien herunterladen</h1>
        <form action="/download-zip" method="get">
            <select name="zipFile" id="zipFileSelect">
                ${zipFileOptions}
            </select>
            <button type="submit">Herunterladen</button>
        </form>
        <script>
            // Aktualisiere das versteckte Eingabefeld basierend auf der Auswahl
            const projectSelect = document.getElementById('projectSelect');
            const configPathInput = document.getElementById('configPathInput');
            projectSelect.addEventListener('change', () => {
                const selectedProject = projectSelect.value;
                configPathInput.value = selectedProject ? '${projectsDir}/' + selectedProject + '/config.json' : '';
            });
            // Setze den initialen Wert
            projectSelect.dispatchEvent(new Event('change'));
        </script>
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

      // Kopiere die config.json in das Projektverzeichnis
      const sourceConfigPath = path.join(__dirname, "config.json");
      const targetConfigPath = path.join(outputFolder, "config.json");

      try {
        fs.copyFileSync(sourceConfigPath, targetConfigPath);
        console.log(`config.json wurde nach ${targetConfigPath} kopiert.`);
      } catch (err) {
        console.error("Fehler beim Kopieren der config.json:", err);
        return res.status(500).send("Fehler beim Kopieren der config.json.");
      }

      // Kombiniere die Drill-Dateien mit Werkzeuganpassung
      combineDrillFilesWithTools(outputFolder);

      // Zeige ein Popup und leite zur Hauptseite weiter
      res.send(`
        <script>
          alert("ZIP-Datei erfolgreich hochgeladen und entpackt!");
          window.location.href = "/";
        </script>
      `);
    })
    .on("error", (err) => {
      console.error("Fehler beim Entpacken:", err);
      res.status(500).send("Fehler beim Entpacken der ZIP-Datei.");
    });
});

//##################################################################################
// Konfiguration bearbeiten
// - Web-Endpunkt für die Bearbeitung der config.json
//##################################################################################
app.get("/edit-config", (req, res) => {
  const configPath = req.query.configPath;

  if (!configPath) {
    return res.status(400).send("Kein Konfigurationspfad angegeben.");
  }

  // Prüfe, ob die config.json existiert
  if (!fs.existsSync(configPath)) {
    return res.status(404).send("Die Konfigurationsdatei wurde nicht gefunden.");
  }

  // Lade die Konfigurationsdatei
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (err) {
    console.error("Fehler beim Laden der Konfigurationsdatei:", err);
    return res.status(500).send("Fehler beim Laden der Konfigurationsdatei.");
  }

  // Erstelle ein Formular für die Konfigurationswerte
  const configFields = Object.entries(config.pcb2gcode || {})
    .map(
      ([key, value]) => `
        <div>
          <label>${key}</label>
          <input type="text" name="${key}" value="${value}" />
        </div>
      `
    )
    .join("");

  res.send(`
    <h1>Bearbeite config.json</h1>
    <form action="/save-config" method="post">
      <input type="hidden" name="configPath" value="${configPath}" />
      ${configFields}
      <div>
        <label>Neuer Parameter</label>
        <input type="text" name="newKey" placeholder="Parametername" />
        <input type="text" name="newValue" placeholder="Wert" />
      </div>
      <button type="submit">Speichern</button>
    </form>
    <a href="/">Zurück</a>
  `);
});

//##################################################################################
// Speichern der Änderungen an der config.json
//##################################################################################
app.post("/save-config", express.urlencoded({ extended: true }), (req, res) => {
  const configPath = req.body.configPath;

  if (!configPath) {
    return res.status(400).send("Kein Konfigurationspfad angegeben.");
  }

  // Prüfe, ob die config.json existiert
  if (!fs.existsSync(configPath)) {
    return res.status(404).send("Die Konfigurationsdatei wurde nicht gefunden.");
  }

  // Lade die bestehende Konfiguration
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (err) {
    console.error("Fehler beim Laden der Konfigurationsdatei:", err);
    return res.status(500).send("Fehler beim Laden der Konfigurationsdatei.");
  }

  // Aktualisiere bestehende Parameter
  Object.keys(req.body).forEach((key) => {
    if (key !== "configPath" && key !== "newKey" && key !== "newValue") {
      config.pcb2gcode[key] = req.body[key];
    }
  });

  // Füge einen neuen Parameter hinzu, falls angegeben
  const newKey = req.body.newKey;
  const newValue = req.body.newValue;
  if (newKey && newValue) {
    config.pcb2gcode[newKey] = newValue;
  }

  // Speichere die aktualisierte Konfiguration
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    console.log(`Konfigurationsdatei aktualisiert: ${configPath}`);
  } catch (err) {
    console.error("Fehler beim Speichern der Konfigurationsdatei:", err);
    return res.status(500).send("Fehler beim Speichern der Konfigurationsdatei.");
  }

  // Zeige ein Popup und leite zur Hauptseite weiter
  res.send(`
    <script>
      alert("Speichern erfolgreich!");
      window.location.href = "/";
    </script>
  `);
});

//##################################################################################
// PCB2GCode Konvertierung
// - Web-Endpunkt für die Konvertierung von Gerber-Dateien in G-Code
// - Führt pcb2gcode mit den konfigurierten Optionen aus
// - Erstellt eine ZIP-Datei mit den G-Code-Dateien
//##################################################################################
app.post("/run-pcb2gcode", (req, res) => {
  const project = req.body.project;

  if (!project) {
    return res.status(400).send("Kein Projekt ausgewählt.");
  }

  const projectPath = path.resolve(__dirname, projectsDir, project);
  const gcodePath = path.resolve(__dirname, gcodeDir, project);
  const zipFilePath = path.resolve(__dirname, downloadDir, `${project}.zip`);
  const projectConfigPath = path.join(projectPath, "config.json");

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

    // Merge der G-Code-Dateien
    mergeMillingFiles(gcodePath);

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
// ZIP-Datei herunterladen
//##################################################################################
app.get("/download-zip", (req, res) => {
  const zipFile = req.query.zipFile;

  if (!zipFile) {
    return res.status(400).send("Keine ZIP-Datei ausgewählt.");
  }

  const zipFilePath = path.join(downloadDir, zipFile);

  if (!fs.existsSync(zipFilePath)) {
    return res.status(404).send("Die ausgewählte ZIP-Datei wurde nicht gefunden.");
  }

  res.download(zipFilePath, zipFile, (err) => {
    if (err) {
      console.error("Fehler beim Herunterladen der ZIP-Datei:", err);
      res.status(500).send("Fehler beim Herunterladen der ZIP-Datei.");
    }
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

//##################################################################################
// Merge Milling Files
// - Kombiniert die Milling-Dateien in einer neuen Datei
//##################################################################################
const mergeMillingFiles = (gcodePath) => {
  const files = ["back.ngc", "outline.ngc", "milldrill.ngc"];
  const outputFile = path.join(gcodePath, "merged_output.ngc");

  const extractSegments = (content) => {
    const lines = content.split("\n");
    let init = [];
    let toolChange = [];
    let milling = [];
    let finish = [];

    let inInit = true;
    let inToolChange = false;
    let inMilling = false;
    let inFinish = false;

    for (const line of lines) {
      if (inInit) {
        init.push(line);
        if (line.includes("(Retract to tool change height)")) {
          inInit = false;
          inToolChange = true;
        }
      } else if (inToolChange) {
        if (line.startsWith("M3")) {
          inToolChange = false;
          inMilling = true;
          milling.push(line);
        } else {
          toolChange.push(line);
        }
      } else if (inMilling) {
        if (line.startsWith("M5")) {
          inMilling = false;
          inFinish = true;
          finish.push(line);
        } else {
          milling.push(line);
        }
      } else if (inFinish) {
        finish.push(line);
      }
    }

    return { init, toolChange, milling, finish };
  };

  let mergedInit = [];
  let mergedMilling = [];
  let mergedFinish = [];

  files.forEach((file, index) => {
    const filePath = path.join(gcodePath, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const { init, milling, finish } = extractSegments(content);

    if (index === 0) {
      // Verwende das Init- und Finish-Segment der ersten Datei (back.ngc)
      mergedInit = init;
      mergedFinish = finish;
    }

    // Füge die Milling-Segmente aller Dateien hinzu
    mergedMilling.push(...milling);
  });

  // Zusammengeführte Inhalte schreiben
  const mergedContent = [
    ...mergedInit,
    ...mergedMilling,
    ...mergedFinish,
  ].join("\n");

  fs.writeFileSync(outputFile, mergedContent, "utf-8");
  console.log(`Zusammengeführte Datei wurde erstellt: ${outputFile}`);
};

// Starte den HTTPS-Server
https.createServer(sslOptions, app).listen(port, () => {
  console.log(`HTTPS-Server läuft auf https://localhost:${port}`);
});
