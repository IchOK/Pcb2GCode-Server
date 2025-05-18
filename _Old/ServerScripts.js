const fs = require("fs");
const path = require("path");

//##################################################################################
// Speicher des letzten Projekts
// - Speichert den Pfad des letzten Projekts in einer JSON-Datei
// - Diese Datei wird beim Start des Servers geladen
//##################################################################################
const saveLastProject = (project) => {
  fs.writeFileSync("lastProject.json", JSON.stringify({ lastProject: project }), "utf-8");
};

//##################################################################################
// Laden des letzten Projekts
// - Liest den Pfad des letzten Projekts aus der JSON-Datei
// - Gibt den Pfad zurück, wenn vorhanden
// - Gibt einen leeren String zurück, wenn kein Projekt gefunden wurde
//##################################################################################
const loadLastProject = () => {
  if (fs.existsSync("lastProject.json")) {
    try {
      const data = JSON.parse(fs.readFileSync("lastProject.json", "utf-8"));
      const projectName = data.lastProject;
      if (projectName) {
        const projectPath = path.join(__dirname, "projects", projectName);
        if (fs.existsSync(projectPath)) {
          return projectName;
        } else {
          saveLastProject(""); // Lösche den Eintrag, wenn der Pfad nicht existiert
          console.warn(`Das Projekt ${projectName} existiert nicht mehr.`);
        }
      }
    } catch (err) {
      console.error("Fehler beim Laden des letzten Projekts:", err);
    }
  }
  return "";
};

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

// Exportiere die Funktionen
module.exports = {
  saveLastProject,
  loadLastProject,
  combineDrillFilesWithTools,
  mergeMillingFiles,
};