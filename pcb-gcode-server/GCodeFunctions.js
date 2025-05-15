/**
 * Kombiniert mehrere Milling-Datei-Inhalte und gibt den kombinierten Inhalt zurück.
 * Die Kodierung wird anhat des Inhalts der Dateien ermittel. Aktuell werden nur pcb2gcode unterstützt.
 *
 * @param {string[]} gcodeContentsArray - Array mit den Inhalten der GCode-Dateien als Strings.
 * @returns {string} Der kombinierte GCode-Inhalt als String.
 *
 * @example
 * const fs = require("fs");
 *
 * let gcodeContents = [];
 * gcodeContents.push(fs.readFileSync(PATH_FILE1), "utf-8"));
 * gcodeContents.push(fs.readFileSync(PATH_FILE2), "utf-8"));
 * ...
 * gcodeContents.push(fs.readFileSync(PATH_FILEn), "utf-8"));
 *
 * const gcodeMerged = mergeGCode( gcodeContents);
 * fs.writeFileSync(PATH_MERGEDFILE), gcodeMerged, "utf-8");
 */
const mergeGCode = (gcodeContentsArray) => {
  let mergedInit = [];
  let mergedMilling = [];
  let mergedFinish = [];

  gcodeContentsArray.forEach((content, index) => {
    let init = [];
    let milling = [];
    let finish = [];

    if (!content) {
      throw new Error("Inhalt der Datei " + index + " ist leer");
    } else if (typeof content !== "string") {
      throw new Error("Inhalt der Datei " + index + " ist kein String");
    } else if (content == "pcb2gcode") {
      ({ init, milling, finish } = extractPcb2GCode(content, codingType));
    } else {
      throw new Error("Die Kodierung der Datei " + index + " ist Unbekannt");
    }

    if (index === 0) {
      mergedInit = init;
      mergedFinish = finish;
    }
    mergedMilling.push(...milling);
  });

  // Kombinierten Inhalt als String zurückgeben
  return [...mergedInit, ...mergedMilling, ...mergedFinish].join("\n");
};

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

// Exportiere die Funktionen
module.exports = { mergeGCode };
