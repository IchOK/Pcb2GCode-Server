const fs = require("fs");
const path = require("path");
const unzipper = require("unzipper");
const { exec } = require("child_process");
const archiver = require("archiver");
const { randomUUID } = require("crypto");

function sanitizeProjectName(name) {
  // Entfernt kritische Zeichen für Dateinamen
  return name.replace(/[^a-zA-Z0-9_\-]/g, "_");
}

// === Konstanten ===
const ROOT_DIR = __dirname;
const PROJECTS_DIR = "projects";
const DEFAULT_CONFIG_FILE = "defaultConfig.json";
const CONFIG_FILE_NAME = "config.json";

class Project {
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
    ws = null, // <--- WebSocket Referenz
  } = {}) {
    this.projectName = projectName;
    this.projectDir = projectDir;
    this.projectConfig = projectConfig;
    this.projectSetup = { ...projectSetup };
    this.gerberVersion = gerberVersion;
    this.gcodeVersion = gcodeVersion;
    this.lastActive = lastActive;
    this.ws = ws; // <--- WebSocket speichern
  }

  createMessage(typeText, statusText, msgText, dataObject) {
    return { type: typeText, status: statusText, msg: msgText, data: dataObject };
  }

  setWebSocket(ws) {
    this.ws = ws;
  }

  sendWS(msgObject) {
    if (this.ws && this.ws.readyState === 1) {
      // 1 = OPEN
      this.ws.send(JSON.stringify(msgObject));
    }
  }

  open(projectName, ws) {
    this.ws = ws;
    if (this.projectName === projectName) return true;

    this.projectName = projectName;
    this.projectDir = sanitizeProjectName(projectName);
    const projectPath = path.join(ROOT_DIR, PROJECTS_DIR, this.projectDir);

    const configPath = path.join(projectPath, CONFIG_FILE_NAME);

    if (!fs.existsSync(configPath)) {
      //------------------------------------------------------
      // Projekt oder ProjektKonfiguration existiert nicht
      //------------------------------------------------------
      // Projektverzeichnis anlegen
      fs.mkdirSync(projectPath, { recursive: true });
      // Default-Konfig einlesen
      const defaultConfigPath = path.join(ROOT_DIR, DEFAULT_CONFIG_FILE);
      let defaultConfig = {};
      if (fs.existsSync(defaultConfigPath)) {
        defaultConfig = JSON.parse(fs.readFileSync(defaultConfigPath, "utf-8"));
      }
      // Default-Konfiguration in config.json speichern
      this.projectConfig = defaultConfig.projectConfig || {};
      this.projectSetup = defaultConfig.projectSetup || { layers: 1, millDrillDia: 0.5, cutterDia: 0.5, boardThickness: 1.7 };
      this.gerberVersion = 0;
      this.gcodeVersion = 0;
      this.save();
    } else {
      //------------------------------------------------------
      // Projekt existiert
      //------------------------------------------------------
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (config) {
        this.projectName = sanitized;
        this.projectDir = path.join(projectsPath, sanitized);
        this.projectConfig = config.projectConfig || {};
        this.projectSetup = config.projectSetup || { layers: 1, millDrillDia: 0.5, cutterDia: 0.5, boardThickness: 1.7 };
        this.gerberVersion = config.gerberVersion || 0;
        this.gcodeVersion = config.gcodeVersion || 0;
      }
    }
  }

  getConfig() {
    let retMsg = this.createMessage("getConfig", "done", "Konfiguration gelesen", this.projectConfig);
    this.sendWS(retMsg);
    return retMsg;
  }

  getSetup() {
    let retMsg = this.createMessage("getSetup", "done", "Setup gelesen", this.projectSetup);
    this.sendWS(retMsg);
    return retMsg;
  }

  setConfig(key, value) {
    this.projectConfig[key] = value;
    let data = {};
    data["key"] = key;
    data["value"] = value;
    let retMsg = this.createMessage("setConfig", "done", "Konfigwert gesetzt", data);
    this.sendWS(retMsg);
    return retMsg;
  }

  setSetup(key, value) {
    let data = {};
    let retMsg = {};
    data["key"] = key;
    data["value"] = value;
    if (key in this.projectSetup) {
      this.projectSetup[key] = value;
      retMsg = this.createMessage("setSetup", "done", "Setupwert gesetzt", data);
    } else {
      retMsg = this.createMessage("setSetup", "error", "Ungültiger Setup-Schlüssel [" + key + "]", data);
    }
    this.sendWS(retMsg);
    return retMsg;
  }

  load() {
    let retMsg = {};
    const configPath = path.join(ROOT_DIR, PROJECTS_DIR, this.projectDir, CONFIG_FILE_NAME);
    // Überprüfen, ob die Konfigurationsdatei existiert
    if (!fs.existsSync(configPath)) {
      retMsg = this.createMessage("load", "error", "Konfigurationsdatei nicht gefunden", {});
      this.sendWS(retMsg);
      return retMsg;
    }
    // Konfigurationsdatei einlesen
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      this.projectConfig = config.projectConfig || {};
      this.projectSetup = config.projectSetup || { layers: 1, millDrillDia: 0.5, cutterDia: 0.5, boardThickness: 1.7 };
      this.gerberVersion = config.gerberVersion || 0;
      this.gcodeVersion = config.gcodeVersion || 0;
      retMsg = this.createMessage("load", "done", "Konfiguration geladen", {
        projectConfig: this.projectConfig,
        projectSetup: this.projectSetup,
        gerberVersion: this.gerberVersion,
        gcodeVersion: this.gcodeVersion,
      });
    } catch (err) {
      retMsg = this.createMessage("load", "error", err.message, {});
    }
    this.sendWS(retMsg);
    return retMsg;
  }

  save(sendMsg = true) {
    let retMsg = {};
    const configPath = path.join(ROOT_DIR, PROJECTS_DIR, this.projectDir, CONFIG_FILE_NAME);
    // Konfig erstellen
    const config = {
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
    } catch (err) {
      retMsg = this.createMessage("save", "error", err.message, {});
    }
    if (sendMsg) {
      this.sendWS(retMsg);
    }
    return retMsg;
  }

  uploadGerber(file) {
    return new Promise((resolve, reject) => {
      let retMsg = {};
      this.sendWS(this.createMessage("uploadGerber", "start", "Gerber Upload gestartet", {}));
      // Erstelle upload-Verzeichnis
      const uploadDir = path.join(this.projectDir, "upload_" + randomUUID());
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

            // Überprüfe, ob das Versionverzeichnis existiert
            this.gerberVersion += 1;
            this.gcodeVersion = 0;
            let newGerberDir = path.join(this.projectDir, `gerberV${this.gerberVersion}`);
            while (fs.existsSync(newGerberDir)) {
              this.gerberVersion += 1;
              newGerberDir = path.join(this.projectDir, `gerberV${this.gerberVersion}`);
            }

            // Tempräreas Verzeichniss umbenennen
            fs.renameSync(uploadDir, newGerberDir);
            this.sendWS(this.createMessage("uploadGerber", "run", "Gerber Versionsverzeichniss angelegt", { state: "dirRenamed" }));

            // Kombiniere die Drill-Dateien mit Werkzeuganpassung
            combineDrillFilesWithTools(newGerberDir);
            this.sendWS(this.createMessage("uploadGerber", "run", "Bohr-Dateien zusammengefügt", { state: "drillMerged" }));

            this.save(false);
            retMsg = this.createMessage("uploadGerber", "done", "Projekt gespeichert", { gerberVersion: this.gerberVersion });
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

  createGCode(shellCommand) {
    return new Promise((resolve, reject) => {
      let retMsg = {};
      this.sendWS(this.createMessage("createGCode", "start", "G-Code erstellen gestartet", {}));
      // Erstelle create-Verzeichnis
      const createDir = path.join(this.projectDir, "create_" + randomUUID());
      fs.mkdirSync(createDir, { recursive: true });
      this.sendWS(this.createMessage("createGCode", "run", "G-Code Temp-Verzeichniss erstellt", { state: "createDir", dir: createDir }));

      exec(shellCommand, { cwd: createDir }, (error, stdout, stderr) => {
        if (error) {
          retMsg = this.createMessage("createGCode", "error", stderr || error.message, {});
          this.sendWS(retMsg);
          return reject(retMsg);
        }

        try {
          // Überprüfe, ob das Versionverzeichnis existiert
          this.gcodeVersion += 1;
          const newGCodeDir = path.join(this.projectDir, `gcodeV${this.gerberVersion}.${this.gcodeVersion}`);
          while (fs.existsSync(newGerberDir)) {
            this.gcodeVersion += 1;
            newGCodeDir = path.join(this.projectDir, `gcodeV${this.gerberVersion}.${this.gcodeVersion}`);
          }

          // Tempräreas Verzeichniss umbenennen
          fs.renameSync(createDir, newGCodeDir);
          this.sendWS(this.createMessage("createGCode", "run", "G-Code Versionsverzeichniss angelegt", { state: "dirRenamed" }));

          this.save(false);
          retMsg = this.createMessage("createGCode", "done", "Projekt gespeichert", { gerberVersion: this.gerberVersion, gcodeVersion: this.gcodeVersion });
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

  downloadGCode(gerberVersion, gcodeVersion) {
    return new Promise((resolve, reject) => {
      let retMsg = {};
      this.sendWS(this.createMessage("downloadGCode", "start", "G-Code erstellen gestartet", {}));
      // Überprüfe ob das GCode-Verzeichnis existiert
      const gcodeDir = path.join(this.projectDir, `gcodeV${gerberVersion}.${gcodeVersion}`);
      if (!fs.existsSync(gcodeDir)) {
        retMsg = this.createMessage("downloadGCode", "error", "G-Code Versionverzeichniss nicht gefunden", { gerberVersion: gerberVersion, gcodeVersion: gcodeVersion });
        this.sendWS(retMsg);
        return reject(retMsg);
      }

      const downloadDir = path.join(ROOT_DIR, "downloads");
      if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

      const zipFile = `${this.projectName}_gcodeV${gerberVersion}.${gcodeVersion}.zip`;
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
}

module.exports = Project;
