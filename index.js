const express = require("express");
const bodyParser = require("body-parser");
const multer = require('multer');
const fs = require("fs");
const spawn = require('child_process').spawn;

let mpvChild;


const app = express();

app.use(express.static("node_modules"));
app.use(bodyParser.json());

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
  mpvChild = spawn('/usr/bin/mplayer', [/*"--image-display-duration=12",*/ process.cwd() + "/uploads/*.jpg"])
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


app.listen(3000, function () {
  console.log("Working on port 3000");

});