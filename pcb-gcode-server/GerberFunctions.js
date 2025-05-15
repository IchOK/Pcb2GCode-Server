/**
 * Kombiniert mehrere Gerber-Drill-Dateien-Inhalte und gibt den kombinierten Drill-Code zurück.
 *
 * @param {string[]} gerberContentsArray - Array mit den Inhalten der Drill-Dateien als Strings.
 * @returns {string} Der kombinierte Drill-Code als String.
 */
const mergeGerberDrilling = (gerberContentsArray) => {
  const globalDrills = new Map(); // Map für Bohrung mit Durchmesser

  gerberContentsArray.forEach((content, index) => {
    const lines = content.split("\n");

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

  // Kombinierten Drill-Code als String erzeugen
  let result = "";
  result += "M48\n";
  result += "METRIC,LZ,000.000\n";
  let toolNumber = 1;
  globalTools.forEach((value, key) => {
    const formattedToolNumber = String(toolNumber).padStart(2, "0");
    result += `T${formattedToolNumber}C${key}\n`;
    toolNumber++;
  });
  result += "%\nG05\nG90\n";

  // Werkzeugverwendungen und Bohrungen
  toolNumber = 1;
  globalTools.forEach((value) => {
    const formattedToolNumber = String(toolNumber).padStart(2, "0");
    result += `T${formattedToolNumber}\n`;
    value.forEach((usage) => {
      result += `${usage}\n`;
    });
    toolNumber++;
  });

  return result;
};

// Exportiere die Funktionen
module.exports = { mergeGerberDrilling };
