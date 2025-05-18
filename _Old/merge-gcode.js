const fs = require("fs");
const path = require("path");

// Verzeichnis mit den G-Code-Dateien
const directory = path.join(__dirname, "gcode");

// Dateien, die zusammengeführt werden sollen
const files = ["back.ngc", "outline.ngc", "milldrill.ngc"];

// Ziel-Datei
const outputFile = path.join(directory, "merged_output.ngc");

// Funktion zum Extrahieren der Segmente
function extractSegments(content) {
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
}

// Zusammenführen der Dateien
let mergedInit = [];
let mergedMilling = [];
let mergedFinish = [];

files.forEach((file, index) => {
  const filePath = path.join(directory, file);
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