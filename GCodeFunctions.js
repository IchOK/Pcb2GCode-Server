const fs = require("fs");
const path = require("path");

// === Konstanten ===
const MERGE_FILE = "MergeBack.ngc";

/**
 * Erstellt den passenden Command-Line-Befehl für das gewählte Routing-Tool.
 * 
 * @param {string} gerberPath - Pfad zum Gerber-Verzeichnis.
 * @param {string} drillFile - Name der Bohrdatei.
 * @param {Object} projectSetup - Projekt-Setup-Objekt.
 * @param {Object} projectConfig - Projekt-Konfigurations-Objekt.
 * @param {Object} globals - Globale Einstellungen.
 * @param {string} createPath - Zielverzeichnis für die Ausgabe.
 * @returns {string} Der vollständige Command-Line-Befehl.
 * @throws {Error} Wenn ein erforderlicher Parameter fehlt oder das Tool nicht bekannt ist.
 */
const getCommand = (gerberPath, drillFile, projectSetup, projectConfig, globals, createPath) => {
  if (!gerberPath) {
    throw new Error("Gerber-Pfad ist nicht definiert");
  }
  if (!drillFile) {
    throw new Error("Bohr-Datei ist nicht definiert");
  }
  if (!projectSetup) {
    throw new Error("Projekt-Setup ist nicht definiert");
  }
  if (!projectConfig) {
    throw new Error("Projekt-Konfiguration ist nicht definiert");
  }
  if (!globals) {
    throw new Error("Globale Variablen sind nicht definiert");
  }
  if (!createPath) {
    throw new Error("Erstellungs-Pfad ist nicht definiert");
  }
  if (!fs.existsSync(gerberPath)) {
    throw new Error("Gerber-Pfad existiert nicht: " + gerberPath);
  }
  if (!fs.existsSync(createPath)) {
    throw new Error("Erstellungs-Pfad existiert nicht: " + createPath);
  }

  if (typeof createCommandMap[projectSetup.routingTool.value] !== "function") {
    throw new Error("createCommandMap kennt das Tool '" + projectSetup.routingTool.value + "' nicht");
  }
  return createCommandMap[projectSetup.routingTool.value](gerberPath, drillFile, projectSetup, projectConfig, globals, createPath);
};

/**
 * Führt das Mergen von GCode-Dateien mit gleichem Werkzeugdurchmesser durch.
 * 
 * @param {string} gcodePath - Pfad zum GCode-Verzeichnis.
 * @param {Object} projectSetup - Projekt-Setup-Objekt.
 * @throws {Error} Wenn Pfade oder das Tool ungültig sind.
 */
const mergeGCode = (gcodePath, projectSetup) => {
  if (!gcodePath) {
    throw new Error("GCode-Pfad ist nicht definiert");
  }
  if (!projectSetup) {
    throw new Error("Projekt-Setup ist nicht definiert");
  }
  if (!fs.existsSync(gcodePath)) {
    throw new Error("GCode-Pfad existiert nicht: " + gcodePath);
  }

  if (typeof getFilesMap[projectSetup.routingTool.value] !== "function") {
    throw new Error("getFilesMap kennt das Tool '" + projectSetup.routingTool.value + "' nicht");
  }
  const files = getFilesMap[projectSetup.routingTool.value](projectSetup);

  let mergeIndex = 1;
  while (files.length > 0) {
    // Nimm das erste Element als Referenz
    const { dia } = files[0];
    // Finde alle Dateien mit gleichem Durchmesser
    const sameDiaFiles = files.filter(f => f.dia === dia);
    // Lese und merge die Inhalte
    const contents = sameDiaFiles.map(f => fs.readFileSync(path.join(gcodePath, f.name), "utf-8"));
    const mergedContent = mergeFiles(contents, projectSetup.routingTool.value);
    // Schreibe das gemergte File
    const mergedFileName = MERGE_FILE.replace(".ngc", `_${mergeIndex}.ngc`);
    fs.writeFileSync(path.join(gcodePath, mergedFileName), mergedContent, "utf-8");
    // Entferne die gemergten Dateien aus dem Array
    files = files.filter(f => f.dia !== dia);
    mergeIndex++;
  }
};

/**
 * Kombiniert mehrere Milling-Datei-Inhalte und gibt den kombinierten Inhalt zurück.
 * Die Kodierung wird anhand des Inhalts der Dateien ermittelt. Aktuell werden nur pcb2gcode unterstützt.
 *
 * @param {string[]} gcodeContentsArray - Array mit den Inhalten der GCode-Dateien als Strings.
 * @param {string} routingTool - Name des Routing-Tools (z.B. "pcb2gcode").
 * @returns {string} Der kombinierte GCode-Inhalt als String.
 */
const mergeFiles = (gcodeContentsArray, routingTool) => {
  let mergedInit = [];
  let mergedMilling = [];
  let mergedFinish = [];

  gcodeContentsArray.forEach((content, index) => {
    let init = [];
    let milling = [];
    let finish = [];

    if (typeof extractMap[routingTool] !== "function") {
      throw new Error("extractMap kennt das Tool '" + projectSetup.routingTool.value + "' nicht");
    }
    ({ init, milling, finish } = extractMap[routingTool](content));
    
    if (index === 0) {
      mergedInit = init;
      mergedFinish = finish;
    }
    mergedMilling.push(...milling);
  });

  // Kombinierten Inhalt als String zurückgeben
  return [...mergedInit, ...mergedMilling, ...mergedFinish].join("\n");
};

//#######################################################################################
//#######################################################################################
//###
//###  Command-Line-Befehl erstellen
//###
//#######################################################################################
//#######################################################################################

/**
 * Erstellt den pcb2gcode-Command-Line-Befehl.
 * 
 * @param {string} gerberPath - Pfad zum Gerber-Verzeichnis.
 * @param {string} drillFile - Name der Bohrdatei.
 * @param {Object} projectSetup - Projekt-Setup-Objekt.
 * @param {Object} projectConfig - Projekt-Konfigurations-Objekt.
 * @param {Object} globals - Globale Einstellungen.
 * @param {string} createPath - Zielverzeichnis für die Ausgabe.
 * @returns {string} Der vollständige pcb2gcode-Befehl.
 */
const createPcb2GCodeCommand = (gerberPath, drillFile, projectSetup, projectConfig, globals, createPath) => {
  // Source Files zu Argumenten hinzufügen
  let setupArgs = {
    back: path.join(gerberPath, projectSetup.backFile.value),
    drill: path.join(gerberPath, drillFile),
    outline: path.join(gerberPath, projectSetup.outlineFile.value),
  };
  if (projectSetup.layer.value) {
    setupArgs["front"] = path.join(gerberPath, projectSetup.frontFile.value);
  }
  setupArgs["output-dir"] = createPath;

  // Projekt-Setup in Command-Line-Argumente umwandeln
  setupArgs["offset"] = projectSetup.isoDia.value / 2.0;
  setupArgs["milldrill-diameter"] = projectSetup.millDrillDia.value;
  setupArgs["cutter-diameter"] = projectSetup.cutterDia.value;
  setupArgs["zwork"] = -projectSetup.isoDepth.value;
  setupArgs["zdrill"] = -(projectSetup.boardThickness.value + globals["drill-offset"]);
  setupArgs["zcut"] = -(projectSetup.boardThickness.value + globals["cutter-offset"]);

  // Projekt-Config hinzufügen, alle Elemente der projectConfig werden als Argumente übergeben
  for (const [key, value] of Object.entries(projectConfig)) {
    setupArgs[key] = value;
  }

  const commandParts = ["pcb2gcode"];
  for (const [key, value] of Object.entries(setupArgs)) {
    commandParts.push(`--${key}=${value}`);
  }
  return commandParts.join(" ");
};
/**
 * Mapping für die Erstellung von Command-Line-Befehlen je nach Tool.
 * @type {Object.<string, Function>}
 */
const createCommandMap = {
  pcb2gcode: createPcb2GCodeCommand,
  //  flatcam: createFlatcamCommand,
};

//#######################################################################################
//#######################################################################################
//###
//###  Liste der mergebaren Dateien
//###
//#######################################################################################
//#######################################################################################

/**
 * Liefert die zu mergen GCode-Dateien für pcb2gcode.
 * 
 * @param {Object} projectSetup - Projekt-Setup-Objekt.
 * @returns {Array<{name: string, dia: number}>} Array mit Dateinamen und Durchmessern.
 */
const getPcb2GCodeFiles = (projectSetup) => {
  return [{
    name: "back.ngc",
    dia: projectSetup.isoDia.value
  }, {
    name: "milldrill.ngc",
    dia: projectSetup.millDrillDia.value
  }, {
    name: "outline.ngc",
    dia: projectSetup.cutterDia.value
  }];
}
/**
 * Mapping für das Ermitteln der GCode-Dateien je nach Tool.
 * @type {Object.<string, Function>}
 */
const getFilesMap = {
  pcb2gcode: getPcb2GCodeFiles,
  //  flatcam: getFlatcamFiles,
};

//#######################################################################################
//#######################################################################################
//###
//###  Extrahierung der Segmente aus GCode-Dateien
//###
//#######################################################################################
//#######################################################################################

/**
 * Extrahiert die Segmente aus einer GCode-Datei, die mit pcb2gcode erstellt wurde.
 *
 * @param {string} content - Inhalt einer GCode-Datei als String.
 * @returns {{init: string[], milling: string[], finish: string[]}}
 *   Ein Objekt mit den Segmenten: Initialisierungscode, Fräscode, Abschlusscode.
 */
const extractPcb2GCode = (content) => {
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

  return { init, milling, finish };
};
/**
 * Mapping für das Extrahieren von Segmenten aus GCode-Dateien je nach Tool.
 * @type {Object.<string, Function>}
 */
const extractMap = {
  pcb2gcode: extractPcb2GCode,
  //flatcam: mergeFlatcam,
};

// Exportiere die Funktionen
module.exports = { getCommand, mergeGCode };
