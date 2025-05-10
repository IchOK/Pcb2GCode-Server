#!/bin/sh

#-------------------------
# Update System
#-------------------------
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get dist-upgrade -y

# Install Build Essentials & GIT
sudo apt-get install -y build-essential git

# Install Useful Tools (Optional)
sudo apt-get install htop iotop nmon lsof screen -y

# Install nodejs
curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
sudo apt-get install -y nodejs

# Get Version info
echo "[NPM] ============"; which npm; npm -v;
echo "[NODE] ============"; which node; node -v

#-------------------------
# CNCjs
#-------------------------
# Install CNCjs
sudo apt-get update
sudo apt-get upgrade -y

# Install Latest Release Version of CNCjs
sudo npm install -g cncjs@latest --unsafe-perm
sudo npm audit fix

rm -r TmpDownload.zip
rm -r cncjs*

# Install TinyWeb
# -Download
DownloadUrl=$(curl -s https://api.github.com/repos/cncjs/cncjs-pendant-tinyweb/releases/latest | grep zipball_url | cut -d '"' -f 4)
wget "$DownloadUrl" -O "TmpDownload.zip"

# -Extract Archive & Delete
unzip TmpDownload.zip -d /home/jochen/
rm -r TmpDownload.zip

# -Move / Rename Tinyweb Directory
rm -r /home/jochen/tinyweb
mv /home/jochen/cncjs-cncjs-pendant-tinyweb*/src /home/jochen/tinyweb
rm -r /home/jochen/cncjs-cncjs-pendant-tinyweb*

# Install TabletWeb
# -Download
DownloadUrl=$(curl -s https://api.github.com/repos/cncjs/cncjs-shopfloor-tablet/releases/latest | grep zipball_url | cut -d '"' -f 4)
wget "$DownloadUrl" -O "TmpDownload.zip"

# -Extract Archive & Delete
unzip TmpDownload.zip -d /home/jochen/
rm -r TmpDownload.zip

# -Move / Rename Tinyweb Directory
rm -r /home/jochen/tablet
mv /home/jochen/cncjs-cncjs-shopfloor-tablet*/src /home/jochen/tablet
rm -r /home/jochen/cncjs-cncjs-shopfloor-tablet*

# -create config
cat <<EOF >~/.cncrc
{
  "mountPoints": [
    {
      "route": "/tinyweb",
      "target": "/home/jochen/tinyweb/"
    },
    {
      "route": "/tablet",
      "target": "/home/jochen/tablet/"
    },
    {
      "route": "/widget",
      "target": "https://cncjs.github.io/cncjs-widget-boilerplate/v1/"
    }
  ],
  "baudrates": [115200],
  "accessTokenLifetime": "30d",
  "allowRemoteAccess": true,
  "controller": "Grbl",
  "state": {
    "checkForUpdates": true
  },
  "commands": [
    {
      "title": "Update (root user)",
      "commands": "sudo npm install -g cncjs@latest --unsafe-perm; pkill -a -f cnc"
    },
    {
      "title": "Update (non-root user)",
      "commands": "npm install -g cncjs@latest; pkill -a -f cnc"
    },
    {
      "title": "Reboot",
      "commands": "sudo /sbin/reboot"
    },
    {
      "title": "Shutdown",
      "commands": "sudo /sbin/shutdown"
    }
  ],
  "events": [],
  "macros": [],
  "users": []
}
EOF

# Install Autolevel
git clone https://github.com/IchOK/cncjs-kt-ext.git
cd cncjs-kt-ext/

sudo npm install
sudo npm audit fix
cd ..
 
#-------------------------
# PM2
#-------------------------
# Install PM2
sudo npm install -g pm2
sudo npm audit fix
sudo pm2 startup

#[PM2] You have to run this command as root. Execute the following command:
#sudo env PATH=$PATH:/usr/bin /usr/local/lib/node_modules/pm2/bin/pm2 startup systemd -u jochen --hp /home/jochen

# Start CNCjs (on port 8000, /w Tinyweb mount point) with PM2
sudo pm2 start $(which cncjs)

# Start Autolevel (on port /usr/ttyUSB0) with PM2
cd cncjs-kt-ext/
sudo pm2 start pm2.config.js
cd ..

# Set current running apps to startup
sudo pm2 save

# Get list of PM2 processes
sudo pm2 list

sudo reboot now

