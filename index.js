const express = require("express");
const bodyParser = require("body-parser");
const multer = require('multer');
const fs = require("fs");
const spawn = require('child_process').spawn;
const WebSocket = require("ws");

let mpvChild;


const app = express();


app.use(express.static("node_modules"));
app.use('/uploads', express.static("uploads"));
app.use('/public', express.static("public"));
app.use(bodyParser.json());

const server = app.listen(3000, function () {
  console.log("Working on port 3000");

});
const wss = new WebSocket.Server({server: server});

const wsAll = [];

function sendListImages(wsArr) {
  fs.readdir(process.cwd() + '/uploads/', (err, listing) => {
    for(let ws of wsArr) {
      ws.send(JSON.stringify(
          { command: "listImages", data: listing}));
    }
  });
}

wss.on('connection', function connection(ws) {

  wsAll.push(ws);

  ws.on('close', function incoming(message) {
    wsAll.splice(wsAll.indexOf(ws), 1);
  });
  ws.on('message', function incoming(message) {

    try {
      const msg = JSON.parse(message)
      switch (msg.command) {
        case "listImages":
          sendListImages([ws]);
          break;
        default:
          ws.send(JSON.stringify({
            answer: 42
          }));

      }

    } catch (e) {

    }
  });
});

const storage = multer.diskStorage({
  destination: function (req, file, callback) {
    callback(null, './uploads');
  },
  filename: function (req, file, callback) {
    let duration = parseInt(req.body.duration)
    if (!duration) {
      duration = 10
    }
    const f = file.originalname;
    const dotIndex = f.lastIndexOf(".");
    let ext = "", name = f;
    if (dotIndex > 0) {
      ext = f.substring(dotIndex, f.left);
      name = f.substring(0, f.length - ext.length);
    }
    callback(null, name + '-' + Date.now() + ext);
  }
});
var upload = multer({storage: storage}).array('userFile', 10);

app.get('/', function (req, res) {
  res.sendFile(__dirname + "/index.html");
});

app.post('/api/photo', function (req, res) {
  upload(req, res, function (err) {
    //req.body
    //req.files
    if (err) {
      return res.end("Error uploading file.");
    }
    sendListImages(wsAll);
    res.end("File is uploaded");
  });
});

app.get('/api/play', function (req, res) {
  //fs.readFile("")
  if (mpvChild) {
    try {
      mpvChild.kill()
    } catch (e) {

    }
  }
  mpvChild = spawn('/usr/bin/mplayer', [-/*"--image-display-duration=12",*/ process.cwd() + "/uploads/*.jpg"])

  mpvChild.stdout.on('data', (data) => {
    console.log(`stdout: ${data}`);
  });

  mpvChild.stderr.on('data', (data) => {
    console.log(`stderr: ${data}`);
  });

  mpvChild.on('close', (code) => {
    console.log(`child process exited with code ${code}`);
  });

});


