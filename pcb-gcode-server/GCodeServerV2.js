const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const unzipper = require('unzipper');

// Erstelle einen Express Server
const app = express();
const port = 3000;

// Ordner für Uploads und Projekte
const uploadDir = 'uploads';
const projectsDir = 'projects';

// Stelle sicher, dass die Ordner existieren
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir);

// Konfiguriere Multer für Datei-Uploads
const upload = multer({ dest: uploadDir });

// Route zur Anzeige der Upload-Seite
app.get('/', (req, res) => {
    res.send(`
        <h1>ZIP-Dateien hochladen</h1>
        <form action="/upload" method="post" enctype="multipart/form-data">
            <input type="file" name="zipFile" />
            <input type="submit" value="Upload!" />
        </form>
    `);
});

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

// Route zum Hochladen und Entpacken der ZIP-Datei
app.post('/upload', upload.single('zipFile'), (req, res) => {
    const zipFile = req.file;

    if (!zipFile) {
        return res.status(400).send('Keine Datei hochgeladen.');
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
        .on('close', () => {
            console.log('ZIP-Datei entpackt:', outputFolder);

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
        .on('error', (err) => {
            console.error('Fehler beim Entpacken:', err);
            res.status(500).send('Fehler beim Entpacken der ZIP-Datei.');
        });
});

// Starte den Server
app.listen(port, () => {
    console.log(`Server läuft auf http://localhost:${port}`);
});