const express = require("express");
const bodyParser = require("body-parser");
const multer = require('multer');
const fs = require("fs");
const spawn = require('child_process').spawn;
const WebSocket = require("ws");
const mongoose = require('mongoose');

const UPLOAD_DIR = process.cwd() + "/uploads";
const UPLOAD_RELATIVE_URI = "/uploads";
const MONGO_DB = "mongodb://localhost/test";

// setup the Server ...

const app = express();

// setup the static routes, serving js files and libraries,...
app.use(express.static("node_modules"));
app.use(UPLOAD_RELATIVE_URI, express.static(UPLOAD_DIR));
app.use('/public', express.static("public"));
app.use(bodyParser.json());

const server = app.listen(3000, function () {
  console.log("Working on port 3000");
});


// setup the database ...

mongoose.connect(MONGO_DB, {useNewUrlParser: true});
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function() {
  console.log("we are connected")
});

const MediaElementSchema = new mongoose.Schema({
  fileName: String,
  duration: Number,
  uploadDate: { type: Date, default: Date.now }
});
const MediaElement = mongoose.model('MediaElement', MediaElementSchema);

/**
 * send a listing of all files in the UPLOAD_DIR to all
 * websocket clients in wsArr
 * @param wsArr: Array[WebSocket]
 */
function sendListFiles(wsArr) {
  fs.readdir(UPLOAD_DIR, (err, listing) => {
    for(let ws of wsArr) {
      ws.send(JSON.stringify(
          { command: "listImages", data: listing}));
    }
  });
}

// Websocket connection setup

const wss = new WebSocket.Server({server: server});

//each connected websocket client will be in the following array
const wsAll = [];

wss.on('connection', ws => {

  wsAll.push(ws);

  ws.on('close',message => {
    wsAll.splice(wsAll.indexOf(ws), 1);
  });

  ws.on('message', message => {

    try {
      const msg = JSON.parse(message);
      switch (msg.command) {
        case "listImages":
          sendListFiles([ws]);
          break;
        default:
          ws.send(JSON.stringify({
            answer: 42
          }));

      }

    } catch (e) {
      console.error("An error pccured while processing the websocket request", e)
    }
  });

});

// prepare everything for the upload
// we ease our live using the multer library, that does everything complicated for us

const storage = multer.diskStorage({
  destination: function (req, file, callback) {
    callback(null, UPLOAD_DIR);
  },
  filename: function (req, file, callback) {
    let duration = parseInt(req.body.duration);
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
    const newFileName = name + '-' + Date.now() + ext;
    //add the MediaElement to the database
    const mediaElement = new MediaElement({ fileName: newFileName, duration: duration});
    mediaElement.save();
    //permanently store as ${newFileName}
    callback(null, newFileName);
  }
});

// will return a new Multer instance that can be used like a function
const upload = multer({storage: storage}).array('userFile', 10);

//serve the index page
app.get('/', function (req, res) {
  res.sendFile(__dirname + "/index.html");
});

//the upload form post request
app.post('/api/photo', function (req, res) {
  upload(req, res, function (err) {
    //req.body
    //req.files
    if (err) {
      return res.end("Error uploading file.");
    }
    //inform all clients about the new media elements
    sendListFiles(wsAll);
    res.end("File has been uploaded");
  });
});

// this was a planed in order to launch a media player. can be omited or used
// as a reference how to start sub processes directly out of node js
let mpvChild;

app.get('/api/play', function (req, res) {
  //fs.readFile("")
  if (mpvChild) {
    try {
      mpvChild.kill()
    } catch (e) {

    }
  }
  mpvChild = spawn('/usr/bin/mplayer', [-/*"--image-display-duration=12",*/ `${UPLOAD_DIR}/*.jpg`]);

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


