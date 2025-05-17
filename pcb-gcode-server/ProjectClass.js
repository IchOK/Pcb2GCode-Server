const fs = require("fs");
const path = require("path");
const unzipper = require("unzipper");
const { exec } = require("child_process");
const archiver = require("archiver");
const { randomUUID } = require("crypto");
const { mergeGerberDrilling } = require("./GerberFunctions");
const { mergeGCode } = require("./GCodeFunctions");
const { rejects } = require("assert");

/**
 * Entfernt kritische Zeichen für Dateinamen.
 * @param {string} name - Projektname.
 * @returns {string} Der bereinigte Projektname.
 */
function sanitizeProjectName(name) {
  return name.replace(/[^a-zA-Z0-9_\-]/g, "_");
}

// === Konstanten ===
const ROOT_DIR = __dirname;
const PROJECTS_DIR = "projects";
const DEFAULT_CONFIG_FILE = "defaultConfig.json";
const CONFIG_FILE_NAME = "config.json";
const DRILLMERGE_FILE_NAME = "Drill_Total.DRL";

class Project {
  /**
   * Erstellt eine neue Projektinstanz.
   * @param {Object} options - Initialisierungsoptionen.
   * @param {string} [options.projectName] - Name des Projekts.
   * @param {string} [options.projectPath] - Projektverzeichnis.
   * @param {Object} [options.projectConfig] - Projekt-Konfiguration.
   * @param {Object} [options.projectSetup] - Projekteinstellungen.
   * @param {number} [options.gerberVersion] - Gerber-Version.
   * @param {number} [options.gcodeVersion] - GCode-Version.
   * @param {number} [options.lastActive] - Letzter Aktivitätszeitpunkt.
   * @param {WebSocket} [options.ws] - WebSocket-Referenz.
   */
  constructor({
    projectName = "",
    projectPath: projectDir = "",
    projectConfig = {},
    projectSetup = {
      layers: 1,
      millDrillDia: 0.5,
      cutterDia: 0.5,
      boardThickness: 1.7,
    },
    gerberVersion = 0,
    gcodeVersion = 0,
    lastActive = Date.now(),
    ws = null,
  } = {}) {
    this.projectName = projectName;
    this.projectDir = projectDir;
    this.projectConfig = projectConfig;
    this.projectSetup = { ...projectSetup };
    this.gerberVersion = gerberVersion;
    this.gcodeVersion = gcodeVersion;
    this.lastActive = lastActive;
    this.ws = ws;
  }

  /**
   * Erstellt eine standardisierte Nachrichtenstruktur.
   * @param {string} typeText - Nachrichtentyp.
   * @param {string} statusText - Status der Nachricht.
   * @param {string} msgText - Nachrichtentext.
   * @param {Object} dataObject - Zusätzliche Daten.
   * @returns {Object} Die Nachrichtenstruktur.
   */
  createMessage(typeText, statusText, msgText, dataObject) {
    return { type: typeText, status: statusText, msg: msgText, data: dataObject };
  }

  /**
   * Setzt die WebSocket-Referenz.
   * @param {WebSocket} ws - WebSocket-Objekt.
   */
  setWebSocket(ws) {
    this.ws = ws;
  }

  /**
   * Sendet eine Nachricht über WebSocket, falls verbunden.
   * @param {Object} msgObject - Die zu sendende Nachricht.
   */
  sendWS(msgObject) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(msgObject));
    }
  }

  /**
   * Verarbeitet eine eingehende WebSocket-Nachricht und ruft die passende Methode auf.
   * @param {string} message - Die empfangene Nachricht (JSON-String).
   */
  handleRequest(message) {
    return new Promise((resolve, reject) => {
      let data;
      try {
        data = JSON.parse(message);
      } catch (err) {
        const retMsg = this.createMessage("handleRequest", "error", err.message, {});
        this.sendWS(retMsg);
        return reject(retMsg);
      }

      // Mapping von Nachrichtentyp zu Methodenname
      const actionMap = {
        open: async () => this.open(data.name),
        getConfig: () => this.getConfig(),
        getSetup: () => this.getSetup(),
        setConfig: () => this.setConfig(data.key, data.value),
        setSetup: () => this.setSetup(data.key, data.value),
        load: async () => this.load(),
        save: async () => this.save(),
        getProjects: () => this.getProjects(),
        getGerberVersions: () => this.getGerberVersions(),
        getGCodeVersions: () => this.getGCodeVersions(data.gerberVersion),
        // Weitere Aktionen nach Bedarf ergänzen
      };

      if (typeof actionMap[data.type] === "function") {
        try {
          // Ergebnis zurückgeben!
          actionMap[data.type]()
            .then((result) => {
              this.sendWS(result);
              return resolve(result);
            })
            .catch((err) => {
              this.sendWS(err);
              return reject(err);
            });
        } catch (err) {
          const retMsg = this.createMessage("handleRequest", "error", err.message, {});
          this.sendWS(retMsg);
          return reject(retMsg);
        }
      } else {
        const retMsg = this.createMessage("handleRequest", "error", "Unbekannter Anfrage-Typ", {});
        this.sendWS(retMsg);
        return reject(retMsg);
      }
    });
  }

  /**
   * Öffnet ein Projekt und lädt ggf. die Konfiguration.
   * @param {string} projectName - Name des Projekts.
   * @returns {Promise<Object>} Promise mit Rückmeldung.
   * @throws {Error} Wenn das Projekt nicht geöffnet werden kann.
   * @throws {Error} Wenn die Konfiguration nicht geladen werden kann.
   * @throws {Error} Wenn das Projekt nicht existiert.
   * @throws {Error} Wenn ein Fehler beim Erstellen des Projekts auftritt.
   * @throws {Error} Wenn ein Fehler beim Speichern der Konfiguration auftritt.
   * @throws {Error} Wenn ein Fehler beim Entpacken der ZIP-Datei auftritt.
   * @throws {Error} Wenn ein Fehler beim Erstellen des G-Codes auftritt.
   */
  open(projectName) {
    return new Promise((resolve, reject) => {
      let retMsg = {};
      this.sendWS(this.createMessage("open", "start", "Projekt öffnen gestartet", {}));
      this.projectName = projectName;
      this.projectDir = sanitizeProjectName(projectName);
      const projectPath = path.join(ROOT_DIR, PROJECTS_DIR, this.projectDir);

      const configPath = path.join(projectPath, CONFIG_FILE_NAME);
      try {
        if (!fs.existsSync(configPath)) {
          //------------------------------------------------------
          // Projekt oder ProjektKonfiguration existiert nicht
          //------------------------------------------------------
          this.sendWS(this.createMessage("open", "run", "Projekt wird erstellt", { state: "create", dir: projectPath }));
          // Projektverzeichnis anlegen
          fs.mkdirSync(projectPath, { recursive: true });
          // Default-Konfig einlesen
          const defaultConfigPath = path.join(ROOT_DIR, DEFAULT_CONFIG_FILE);
          let defaultConfig = {};
          if (fs.existsSync(defaultConfigPath)) {
            this.sendWS(this.createMessage("open", "run", "Default Konfig wird gelesen", { state: "getDefault", dir: defaultConfigPath }));
            defaultConfig = JSON.parse(fs.readFileSync(defaultConfigPath, "utf-8"));
          }
          // Default-Konfiguration in config.json speichern
          this.projectConfig = defaultConfig.projectConfig || {};
          this.projectSetup = defaultConfig.projectSetup || { layers: 1, millDrillDia: 0.5, cutterDia: 0.5, boardThickness: 1.7 };
          this.gerberVersion = 0;
          this.gcodeVersion = 0;
          this.save(false);
          retMsg = this.createMessage("open", "done", "Projekt erstellt", this);
          this.sendWS(retMsg);
          return resolve(retMsg);
        } else {
          //------------------------------------------------------
          // Projekt existiert
          //------------------------------------------------------
          this.sendWS(this.createMessage("open", "run", "Projekt wird eingelsen", { state: "get", dir: projectPath }));
          const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
          if (config) {
            this.projectConfig = config.projectConfig || {};
            this.projectSetup = config.projectSetup || { layers: 1, millDrillDia: 0.5, cutterDia: 0.5, boardThickness: 1.7 };
            this.gerberVersion = config.gerberVersion || 0;
            this.gcodeVersion = config.gcodeVersion || 0;
            const data = {
              projectName: this.projectName,
              projectConfig: this.projectConfig,
              projectSetup: this.projectSetup,
              gerberList: this.listGerberVersions(projectPath),
              gerberVersion: this.gerberVersion,
              gcodeList: this.listGCodeVersions(projectPath, this.gerberVersion),
              gcodeVersion: this.gcodeVersion,
            };
            retMsg = this.createMessage("open", "done", "Projekt geöffnet", data);
            this.sendWS(retMsg);
            return resolve(retMsg);
          } else {
            retMsg = this.createMessage("open", "error", "Projekt-Konfiguration ist leer", {});
            this.sendWS(retMsg);
            return reject(retMsg);
          }
        }
      } catch (err) {
        retMsg = this.createMessage("open", "error", err.message, {});
        this.sendWS(retMsg);
        return reject(retMsg);
      }
    });
  }

  /**
   * Gibt die Projekt-Konfiguration zurück und sendet sie per WebSocket.
   * @returns {Promise<Object>} Die Konfigurationsnachricht.
   */
  getConfig() {
    return new Promise((resolve) => {
      let retMsg = this.createMessage("getConfig", "done", "Konfiguration gelesen", this.projectConfig);
      this.sendWS(retMsg);
      return resolve(retMsg);
    });
  }

  /**
   * Gibt die Projekt-Setup-Daten zurück und sendet sie per WebSocket.
   * @returns {Promise<Object>} Die Setup-Nachricht.
   */
  getSetup() {
    return new Promise((resolve) => {
      let retMsg = this.createMessage("getSetup", "done", "Setup gelesen", this.projectSetup);
      this.sendWS(retMsg);
      return resolve(retMsg);
    });
  }

  /**
   * Setzt einen Wert in der Projekt-Konfiguration und sendet eine Nachricht.
   * @param {string} key - Konfigurationsschlüssel.
   * @param {*} value - Neuer Wert.
   * @returns {Promise<Object>} spiegelt den gesetzten wert zurück.
   */
  setConfig(key, value) {
    return new Promise((resolve) => {
      this.projectConfig[key] = value;
      let data = { key, value };
      let retMsg = this.createMessage("setConfig", "done", "Konfigwert gesetzt", data);
      this.sendWS(retMsg);
      return resolve(retMsg);
    });
  }

  /**
   * Setzt einen Wert im Projekt-Setup und sendet eine Nachricht.
   * @param {string} key - Setup-Schlüssel.
   * @param {*} value - Neuer Wert.
   * @returns {Promise<Object>} spiegelt den gesetzten Wert zurück.
   * @throws {Error} Wenn der Schlüssel ungültig ist.
   */
  setSetup(key, value) {
    return new Promise((resolve, reject) => {
      let data = { key, value };
      let retMsg;
      if (key in this.projectSetup) {
        this.projectSetup[key] = value;
        retMsg = this.createMessage("setSetup", "done", "Setupwert gesetzt", data);
        this.sendWS(retMsg);
        return resolve(retMsg);
      } else {
        retMsg = this.createMessage("setSetup", "error", "Ungültiger Setup-Schlüssel [" + key + "]", data);
        this.sendWS(retMsg);
        return reject(retMsg);
      }
    });
  }

  /**
   * Lädt die Projekt-Konfiguration aus der Datei.
   * @returns {Promise<Object>} gibt die kompletten Projektinformationen zurück.
   * @throws {Error} Wenn die Konfigurationsdatei nicht gefunden wird.
   * @throws {Error} Wenn ein Fehler beim Einlesen der Konfiguration auftritt.
   */
  load() {
    return new Promise((resolve, reject) => {
      let retMsg = {};
      const projectPath = path.join(ROOT_DIR, PROJECTS_DIR, this.projectDir);
      const configPath = path.join(projectPath, CONFIG_FILE_NAME);
      // Überprüfen, ob die Konfigurationsdatei existiert
      if (!fs.existsSync(configPath)) {
        retMsg = this.createMessage("load", "error", "Konfigurationsdatei nicht gefunden", {});
        this.sendWS(retMsg);
        return reject(retMsg);
      }
      // Konfigurationsdatei einlesen
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        this.projectConfig = config.projectConfig || {};
        this.projectSetup = config.projectSetup || { layers: 1, millDrillDia: 0.5, cutterDia: 0.5, boardThickness: 1.7 };
        this.gerberVersion = config.gerberVersion || 0;
        this.gcodeVersion = config.gcodeVersion || 0;
        const data = {
          projectName: this.projectName,
          projectConfig: this.projectConfig,
          projectSetup: this.projectSetup,
          gerberList: this.listGerberVersions(projectPath),
          gerberVersion: this.gerberVersion,
          gcodeList: this.listGCodeVersions(projectPath, this.gerberVersion),
          gcodeVersion: this.gcodeVersion,
        };
        retMsg = this.createMessage("load", "done", "Konfiguration geladen", data);
        this.sendWS(retMsg);
        return resolve(retMsg);
      } catch (err) {
        retMsg = this.createMessage("load", "error", err.message, {});
        this.sendWS(retMsg);
        return reject(retMsg);
      }
    });
  }

  /**
   * Speichert die aktuelle Projekt-Konfiguration in die Datei.
   * @param {boolean} [sendMsg=true] - Ob eine Nachricht gesendet werden soll.
   * @returns {Promise<Object>} gibt die gespeicherten Projektinformationen zurück.
   * @throws {Error} Wenn ein Fehler beim Speichern auftritt.
   */
  save(sendMsg = true) {
    return new Promise((resolve, reject) => {
      let retMsg = {};
      const projectPath = path.join(ROOT_DIR, PROJECTS_DIR, this.projectDir);
      const configPath = path.join(projectPath, CONFIG_FILE_NAME);
      // Konfig erstellen
      const config = {
        name: this.projectName,
        projectConfig: this.projectConfig,
        projectSetup: this.projectSetup,
        gerberVersion: this.gerberVersion,
        gcodeVersion: this.gcodeVersion,
      };
      try {
        // Konfigdatei speichern
        const jsonString = JSON.stringify(config, null, 2);
        fs.writeFileSync(configPath, jsonString, "utf-8");
        retMsg = this.createMessage("save", "done", "Konfiguration gespeichert", config);
        if (sendMsg) {
          this.sendWS(retMsg);
        }
        return resolve(retMsg);
      } catch (err) {
        retMsg = this.createMessage("save", "error", err.message, {});
        if (sendMsg) {
          this.sendWS(retMsg);
        }
        return reject(retMsg);
      }
    });
  }

  /**
   * Entpackt eine Gerber-ZIP-Datei, legt ein neues Versionsverzeichnis an und kombiniert Drill-Dateien.
   * @param {string} file - Pfad zur ZIP-Datei.
   * @returns {Promise<Object>} gibt die Gerber Version zurück.
   * @throws {Error} Wenn ein Fehler beim Entpacken oder Erstellen des Verzeichnisses auftritt.
   * @throws {Error} Wenn ein Fehler beim Kombinieren der Drill-Dateien auftritt.
   * @throws {Error} Wenn ein Fehler beim Speichern des Projekts auftritt.
   */
  uploadGerber(file) {
    return new Promise((resolve, reject) => {
      const projectPath = path.join(ROOT_DIR, PROJECTS_DIR, this.projectDir);
      let retMsg = {};
      this.sendWS(this.createMessage("uploadGerber", "start", "Gerber Upload gestartet", {}));
      // Erstelle upload-Verzeichnis
      const uploadDir = path.join(projectPath, "upload_" + randomUUID());
      fs.mkdirSync(uploadDir, { recursive: true });
      this.sendWS(this.createMessage("uploadGerber", "run", "Gerber Temp-Verzeichniss erstellt", { state: "createDir", dir: uploadDir }));

      fs.createReadStream(file)
        .pipe(unzipper.Extract({ path: uploadDir }))
        .on("close", () => {
          try {
            this.sendWS(this.createMessage("uploadGerber", "run", "Gerber-Datei entpackt", { state: "unzipDone" }));
            // Lösche die hochgeladene ZIP-Datei
            fs.unlinkSync(file);
            this.sendWS(this.createMessage("uploadGerber", "run", "Upload ZIP-File gelöscht", { state: "zipDeleted" }));

            // Ermittle anhand der Gerber-Liste die nächste Version
            const gerberList = this.listGerberVersions(projectPath);
            if (gerberList.length > 0) {
              this.gerberVersion = Math.max(...gerberList) + 1;
            } else {
              this.gerberVersion = 1;
            }
            this.gcodeVersion = 0;
            let newGerberDir = path.join(projectPath, `gerberV${this.gerberVersion}`);

            // Tempräreas Verzeichniss umbenennen
            fs.renameSync(uploadDir, newGerberDir);
            this.sendWS(this.createMessage("uploadGerber", "run", "Gerber Versionsverzeichniss angelegt", { state: "dirRenamed" }));

            // Kombiniere die Drill-Dateien mit Werkzeuganpassung
            const drillFiles = fs.readdirSync(newGerberDir).filter((file) => file.endsWith(".DRL") && file !== DRILLMERGE_FILE_NAME);
            const drillContentsArray = drillFiles.map((file) => fs.readFileSync(path.join(newGerberDir, file), "utf-8"));
            const combinedDrillContent = mergeGerberDrilling(drillContentsArray);
            const combinedDrillFilePath = path.join(newGerberDir, DRILLMERGE_FILE_NAME);
            fs.writeFileSync(combinedDrillFilePath, combinedDrillContent, "utf-8");
            this.sendWS(this.createMessage("uploadGerber", "run", "Bohr-Dateien zusammengefügt", { state: "drillMerged" }));

            this.save(false);

            const data = {
              gerberList: this.listGerberVersions(projectPath),
              gerberVersion: this.gerberVersion,
              gcodeList: this.listGCodeVersions(projectPath, this.gerberVersion),
              gcodeVersion: this.gcodeVersion,
            };
            retMsg = this.createMessage("uploadGerber", "done", "Projekt gespeichert", data);
            this.sendWS(retMsg);
            return resolve(retMsg);
          } catch (err) {
            retMsg = this.createMessage("uploadGerber", "error", err.message, {});
            this.sendWS(retMsg);
            return reject(retMsg);
          }
        })
        .on("error", (err) => {
          retMsg = this.createMessage("uploadGerber", "error", err.message, {});
          this.sendWS(retMsg);
          return reject(retMsg);
        });
    });
  }

  /**
   * Erstellt G-Code durch Ausführen eines Shell-Kommandos und legt ein neues Versionsverzeichnis an.
   * @param {string} shellCommand - Der auszuführende Shell-Befehl.
   * @returns {Promise<Object>} Gibt die Gerber und G-Code Version zurück.
   * @throws {Error} Wenn ein Fehler beim Erstellen des G-Codes auftritt.
   * @throws {Error} Wenn ein Fehler beim Umbenennen des Verzeichnisses auftritt.
   */
  createGCode(shellCommand) {
    return new Promise((resolve, reject) => {
      const projectPath = path.join(ROOT_DIR, PROJECTS_DIR, this.projectDir);
      let retMsg = {};
      this.sendWS(this.createMessage("createGCode", "start", "G-Code erstellen gestartet", {}));
      // Erstelle create-Verzeichnis
      const createDir = path.join(projectPath, "create_" + randomUUID());
      fs.mkdirSync(createDir, { recursive: true });
      this.sendWS(this.createMessage("createGCode", "run", "G-Code Temp-Verzeichniss erstellt", { state: "createDir", dir: createDir }));

      exec(shellCommand, { cwd: createDir }, (error, stdout, stderr) => {
        if (error) {
          retMsg = this.createMessage("createGCode", "error", stderr || error.message, {});
          this.sendWS(retMsg);
          return reject(retMsg);
        }

        try {
          // Ermittle anhand der GCode-Liste die nächste Version
          const gcodeList = this.listGCodeVersions(projectPath, this.gerberVersion);
          if (gcodeList.length > 0) {
            this.gcodeVersion = Math.max(...gcodeList) + 1;
          } else {
            this.gcodeVersion = 1;
          }
          const newGCodeDir = path.join(projectPath, `gcodeV${this.gerberVersion}.${this.gcodeVersion}`);

          // Tempräreas Verzeichniss umbenennen
          fs.renameSync(createDir, newGCodeDir);
          this.sendWS(this.createMessage("createGCode", "run", "G-Code Versionsverzeichniss angelegt", { state: "dirRenamed" }));

          this.save(false);

          const data = {
            gerberList: this.listGerberVersions(projectPath),
            gerberVersion: this.gerberVersion,
            gcodeList: this.listGCodeVersions(projectPath, this.gerberVersion),
            gcodeVersion: this.gcodeVersion,
          };
          retMsg = this.createMessage("createGCode", "done", "Projekt gespeichert", data);
          this.sendWS(retMsg);
          return resolve(retMsg);
        } catch (err) {
          retMsg = this.createMessage("createGCode", "error", err.message, {});
          this.sendWS(retMsg);
          return reject(retMsg);
        }
      });
    });
  }

  /**
   * Erstellt ein ZIP-Archiv des G-Code-Verzeichnisses für den Download.
   * @param {number} gerberVersion - Gerber-Version.
   * @param {number} gcodeVersion - GCode-Version.
   * @returns {Promise<Object>} gibt die Gerber und G-Code Version zurück, sowie den Namen der ZIP-Datei.
   * @throws {Error} Wenn das GCode-Verzeichnis nicht gefunden wird.
   * @throws {Error} Wenn ein Fehler beim Erstellen des ZIP-Archivs auftritt.
   */
  downloadGCode(gerberVersion, gcodeVersion) {
    return new Promise((resolve, reject) => {
      const projectPath = path.join(ROOT_DIR, PROJECTS_DIR, this.projectDir);
      let retMsg = {};
      this.sendWS(this.createMessage("downloadGCode", "start", "G-Code erstellen gestartet", {}));
      // Überprüfe ob das GCode-Verzeichnis existiert
      const gcodeDir = path.join(projectPath, `gcodeV${gerberVersion}_${gcodeVersion}`);
      if (!fs.existsSync(gcodeDir)) {
        retMsg = this.createMessage("downloadGCode", "error", "G-Code Versionverzeichniss nicht gefunden", { gerberVersion: gerberVersion, gcodeVersion: gcodeVersion });
        this.sendWS(retMsg);
        return reject(retMsg);
      }

      const downloadDir = path.join(ROOT_DIR, "downloads");
      if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

      const zipFile = `${this.projectName}_gcodeV${gerberVersion}_${gcodeVersion}.zip`;
      const zipFilePath = path.join(downloadDir, zipFile);

      this.sendWS(this.createMessage("downloadGCode", "run", "ZIP-Datei wird erstellt [" + zipFile + "]", { name: zipFile }));
      const output = fs.createWriteStream(zipFilePath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      output.on("close", () => {
        retMsg = this.createMessage("downloadGCode", "done", "ZIP-Datei wird erstellt [" + zipFile + "]", { gerberVersion: gerberVersion, gcodeVersion: gcodeVersion, name: zipFile });
        this.sendWS(retMsg);
        return resolve(retMsg);
      });
      archive.on("error", (err) => {
        retMsg = this.createMessage("downloadGCode", "error", err.message, {});
        this.sendWS(retMsg);
        return reject(retMsg);
      });

      archive.pipe(output);
      archive.directory(gcodeDir, false);
      archive.finalize();
    });
  }

  /**
   * Gibt alle vorhandenen Gerber-Versionsnummern als Array zurück.
   * @returns {Object} Rückmeldung mit Array der Versionsnummern.
   * @throws {Error} Wenn das Projektverzeichnis nicht gefunden wird.
   */
  getProjects() {
    return new Promise((resolve, reject) => {
      let retMsg = {};
      try {
        const projectsPath = path.join(ROOT_DIR, PROJECTS_DIR);
        if (!fs.existsSync(projectsPath)) {
          retMsg = this.createMessage("getProjects", "error", "Verzeichnis der Projekte nicht gefunden", []);
          this.sendWS(retMsg);
          return resolve(retMsg);
        }

        const Projects = this.listProjects(projectsPath);
        retMsg = this.createMessage("getProjects", "done", "Projekte gefunden", Projects);
        this.sendWS(retMsg);
        return resolve(retMsg);
      } catch (err) {
        retMsg = this.createMessage("getProjects", "error", err.message, []);
        this.sendWS(retMsg);
        return reject(retMsg);
      }
    });
  }

  /**
   * Gibt alle vorhandenen Gerber-Versionsnummern als Array zurück.
   * @returns {Object} Rückmeldung besteht aus Versionsnummer und aktuellen Versionen von Gerber und GCode.
   * @throws {Error} Wenn das Projektverzeichnis nicht gefunden wird.
   */
  getGerberVersions() {
    return new Promise((resolve, reject) => {
      let retMsg = {};
      try {
        const projectPath = path.join(ROOT_DIR, PROJECTS_DIR, this.projectDir);
        if (!fs.existsSync(projectPath)) {
          retMsg = this.createMessage("getGerberVersions", "error", "Projektverzeichnis nicht gefunden", []);
          this.sendWS(retMsg);
          return resolve(retMsg);
        }

        // Suche Gerber und G-Code-Versionen
        const data = {
          gerberList: this.listGerberVersions(projectPath),
          gerberVersion: this.gerberVersion,
          gcodeList: this.listGCodeVersions(projectPath, this.gerberVersion),
          gcodeVersion: this.gcodeVersion,
        };

        retMsg = this.createMessage("getGerberVersions", "done", "Gerber-Versionen gefunden", data);
        this.sendWS(retMsg);
        return resolve(retMsg);
      } catch (err) {
        retMsg = this.createMessage("getGerberVersions", "error", err.message, []);
        this.sendWS(retMsg);
        return reject(retMsg);
      }
    });
  }

  /**
   * Gibt alle vorhandenen GCode-Versionsnummern für eine Gerber-Version als Array zurück.
   * @param {number} gerberVersion - Die Gerber-Version.
   * @returns {Object} Rückmeldung mit Array der GCode-Versionsnummern.
   */
  getGCodeVersions(gerberVersion) {
    return new Promise((resolve, reject) => {
      let retMsg = {};
      try {
        this.gerberVersion = gerberVersion;
        const projectPath = path.join(ROOT_DIR, PROJECTS_DIR, this.projectDir);
        if (!fs.existsSync(projectPath)) {
          retMsg = this.createMessage("getGCodeVersions", "error", "Projektverzeichnis nicht gefunden", []);
          this.sendWS(retMsg);
          return resolve(retMsg);
        }

        // Suche nach G-Code-Versionen
        const data = {
          gcodeList: this.listGCodeVersions(projectPath, this.gerberVersion),
          gcodeVersion: this.gcodeVersion,
        };

        retMsg = this.createMessage("getGCodeVersions", "done", "GCode-Versionen gefunden", data);
        this.sendWS(retMsg);
        return resolve(retMsg);
      } catch (err) {
        retMsg = this.createMessage("getGCodeVersions", "error", err.message, []);
        this.sendWS(retMsg);
        return reject(retMsg);
      }
    });
  }

  listProjects(projectsPath) {
    // Durchsuche Projekt-Unterverzeinisse nach config.json
    const Projects = fs
      .readdirSync(projectsPath)
      .filter((name) => fs.statSync(path.join(projectsPath, name)).isDirectory())
      .map((name) => {
        const projectPath = path.join(projectsPath, name);
        const configPath = path.join(projectPath, CONFIG_FILE_NAME);
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
          return config.name || null; // Falls name fehlt oder leer ist, null zurückgeben
        }
        return null;
      })
      .filter((project) => !!project); // Entfernt null, undefined und leere Strings
    return Projects;
  }

  listGerberVersions(projectPath) {
    // Suche nach Verzeichnissen im Format "gerberV<nummer>"
    const versions = fs
      .readdirSync(projectPath)
      .filter((name) => /^gerberV\d+$/.test(name) && fs.statSync(path.join(projectPath, name)).isDirectory())
      .map((name) => parseInt(name.replace("gerberV", ""), 10))
      .sort((a, b) => a - b);
    return versions;
  }

  listGCodeVersions(projectPath, gerberVersion) {
    // Suche nach Verzeichnissen im Format "gcodeV<gerberVersion>_<gcodeVersion>"
    const regex = new RegExp(`^gcodeV${gerberVersion}_(\\d+)$`);
    const versions = fs
      .readdirSync(projectPath)
      .map((name) => {
        const match = name.match(regex);
        if (match && fs.statSync(path.join(projectPath, name)).isDirectory()) {
          return parseInt(match[1], 10);
        }
        return null;
      })
      .filter((v) => v !== null)
      .sort((a, b) => a - b);
    return versions;
  }
}

module.exports = Project;
