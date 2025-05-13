const fs = require("fs");
const path = require("path");
const unzipper = require("unzipper");
const { exec } = require("child_process");
const archiver = require("archiver");

function sanitizeProjectName(name) {
  // Entfernt kritische Zeichen für Dateinamen
  return name.replace(/[^a-zA-Z0-9_\-]/g, "_");
}

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
    rootDir = __dirname,
    projectsDir = "projects",
    defaultConfigFile = "defaultConfig.json"
  } = {}) {
    this.projectName = projectName;
    this.projectDir = projectDir;
    this.projectConfig = projectConfig;
    this.projectSetup = { ...projectSetup };
    this.gerberVersion = gerberVersion;
    this.gcodeVersion = gcodeVersion;
    this.rootDir = rootDir;
    this.projectsDir = projectsDir;
    this.defaultConfigFile = defaultConfigFile;
  }

  open(projectName) {
    if (this.projectName === projectName) return true;

    this.projectName = projectName;
    this.projectDir = sanitizeProjectName(projectName);
    const projectPath = path.join(this.rootDir, this.projectsDir, this.projectDir);

    if (!fs.existsSync(path.join(projectPath, "config.json"))) {
      //------------------------------------------------------
      // Projekt oder ProjektKonfiguration existiert nicht
      //------------------------------------------------------
      // Projektverzeichnis anlegen
      fs.mkdirSync(projectPath, { recursive: true });
      // Default-Konfig einlesen
      const defaultConfigPath = path.join(this.rootDir, this.defaultConfigFile);
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
    return this.projectConfig;
  }

  getSetup() {
    return this.projectSetup;
  }

  setConfig(key, value) {
    this.projectConfig[key] = value;
  }

  setSetup(key, value) {
    if (key in this.projectSetup) {
      this.projectSetup[key] = value;
    }
  }

  read() {
    const configPath = path.join(this.rootDir, this.projectsDir, this.projectDir, "config.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      this.projectConfig = config.projectConfig || {};
      this.projectSetup = config.projectSetup || { layers: 1, millDrillDia: 0.5, cutterDia: 0.5, boardThickness: 1.7 };
      this.gerberVersion = config.gerberVersion || 0;
      this.gcodeVersion = config.gcodeVersion || 0;
    }
  }

  save() {
    const configPath = path.join(this.rootDir, this.projectsDir, this.projectDir, "config.json");
    const config = {
      projectConfig: this.projectConfig,
      projectSetup: this.projectSetup,
      gerberVersion: this.gerberVersion,
      gcodeVersion: this.gcodeVersion,
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  }

  uploadGerber(file) {
    const uploadDir = path.join(this.projectDir, "upload");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    // Entpacke ZIP-Datei
    fs.createReadStream(file)
      .pipe(unzipper.Extract({ path: uploadDir }))
      .on("close", () => {
        // Lösche die hochgeladene ZIP-Datei
        fs.unlinkSync(zipFilePath);

        // Wenn erfolgreich
        this.gerberVersion += 1;
        this.gcodeVersion = 0;
        const newGerberDir = path.join(this.projectDir, `gerberV${this.gerberVersion}`);
        if (fs.existsSync(newGerberDir)) fs.rmSync(newGerberDir, { recursive: true, force: true });
        fs.renameSync(uploadDir, newGerberDir);

        // Kombiniere die Drill-Dateien mit Werkzeuganpassung
        combineDrillFilesWithTools(newGerberDir);

        this.save();

        // Zeige ein Popup und leite zur Hauptseite weiter
        //return res.json({ success: true, message: "Gerber ZIP erfolgreich hochgeladen und entpackt!" });
      })
      .on("error", (err) => {
        //return res.json({ success: false, message: "Fehler beim Upload der Gerber ZIP.\n" + err });
      });
  }

  createGCode(shellCommand) {
    return new Promise((resolve, reject) => {
      const createDir = path.join(this.projectDir, "create");
      if (!fs.existsSync(createDir)) fs.mkdirSync(createDir, { recursive: true });

      exec(shellCommand, { cwd: createDir }, (error, stdout, stderr) => {
        if (error) return reject(stderr || error.message);

        this.gcodeVersion += 1;
        const newGCodeDir = path.join(
          this.projectDir,
          `gcodeV${this.gerberVersion}.${this.gcodeVersion}`
        );
        if (fs.existsSync(newGCodeDir)) fs.rmSync(newGCodeDir, { recursive: true, force: true });
        fs.renameSync(createDir, newGCodeDir);

        this.save();
        resolve(newGCodeDir);
      });
    });
  }

  async downloadGCode(gerberVersion, gcodeVersion) {
    const gcodeDir = path.join(
      this.projectDir,
      `gcodeV${gerberVersion}.${gcodeVersion}`
    );
    if (!fs.existsSync(gcodeDir)) return null;

    const downloadDir = path.join(this.rootDir, "downloads");
    if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

    const zipFile = `${this.projectName}_gcodeV${gerberVersion}.${gcodeVersion}.zip`;
    const zipFilePath = path.join(downloadDir, zipFile);

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipFilePath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      output.on("close", resolve);
      archive.on("error", reject);

      archive.pipe(output);
      archive.directory(gcodeDir, false);
      archive.finalize();
    });

    return zipFile;
  }
}

module.exports = Project;