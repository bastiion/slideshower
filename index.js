const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo")(session);
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const multer = require('multer');
const fs = require("fs");
const spawn = require('child_process').spawn;
const WebSocket = require("ws");
const mongoose = require('mongoose');
const mime = require('mime-types');

const SECRET = '0628b93e0a9058f1cdaf59f92de22bac';
const UPLOAD_DIR = process.cwd() + "/uploads";
const UPLOAD_RELATIVE_URI = "/uploads";
const MONGO_DB = "mongodb://localhost/test";
const DEFAULT_DURATION = 5;

// setup the Server ...

const app = express();
const cookieParserInstance = cookieParser(SECRET)

// setup the static routes, serving js files and libraries,...
app.use(express.static("node_modules"));
app.use(UPLOAD_RELATIVE_URI, express.static(UPLOAD_DIR));
app.use('/public', express.static("public"));
app.use(bodyParser.json());
app.use(cookieParserInstance);
app.set('json spaces', 4);

const server = app.listen(3000, () => {
  console.log("Working on port 3000");
});


// setup the database ...

mongoose.connect(MONGO_DB, {useNewUrlParser: true});
const db = mongoose.connection;
const mongoStore = new MongoStore({mongooseConnection: db});
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', () => {
  console.log("we are connected")
});
app.use(session({
  secret: SECRET,
  resave: false,
  saveUninitialized: true,
  store: mongoStore,
  autoRemove: 'native'
}));

const MediaElementSchema = new mongoose.Schema({
  fileName: String,
  duration: Number,
  orderIndex: {type: Number, default: () => parseInt(Math.random() * 10000)},
  mimeType: String,
  uploadDate: {type: Date, default: Date.now}
});
const MediaElement = mongoose.model('MediaElement', MediaElementSchema);

const SlideshowSessionSchema = new mongoose.Schema({
  sessionID: String,
  currentMediaElementId: String,
  currentMediaElementFileName: String,
  currentMediaElementMimeType: String,
  playerVolume: Number,
  playerPos: Number,
  playerPaused: Boolean
});
const SlideshowSession = mongoose.model('SlieshowSession', SlideshowSessionSchema);

/**
 * send a listing of all files in the UPLOAD_DIR to all}
 * websocket clients in wsArr
 * @param wsArr: Array[WebSocket]
 */
function sendListFiles(wsArr) {
  fs.readdir(UPLOAD_DIR, (err, listing) => {
    for (let ws of wsArr) {
      ws.send(JSON.stringify(
          {command: "listImages", data: listing}));
    }
  });
}

function sendPlaylist(wsArr) {
  MediaElement.find().sort({'orderIndex': 'asc'}).exec().then(playlist => {
    for (let ws of wsArr) {
      ws.send(JSON.stringify(
          {command: "playlist", data: playlist}));
    }
  });
}

function sendSlideshowSessions(wsArr) {
  SlideshowSession.find().sort({'sessionID': 'asc'}).exec().then(sessions => {
    for (let ws of wsArr) {
      ws.send(JSON.stringify(
          {command: "slideshowSessions", data: sessions}));
    }
  });
}

function sendNewElements(elements, wsArr) {
  for (let ws of wsArr) {
    ws.send(JSON.stringify(
        {command: "newElements", data: elements}));
  }
}
function sendPlayerVolumeUpdate(volume, wsArr) {
  for (let ws of wsArr) {
    ws.send(JSON.stringify(
        {command: "updatePlayerVolume", data: volume}));
  }
}


// Websocket connection setup

const wss = new WebSocket.Server({server: server});

//each connected websocket client will be in the following array
const wsAllMap = [];

function wsAll() {
  return wsAllMap.map(item => item.ws);
}

function sessionIDForWS(ws) {
  const index = wsAllMap.findIndex(item => item.ws === ws);
  if (index >= 0) {
    return wsAllMap[index].sessionID;
  }
  return null;
}
function wsForSessionID(sessionID) {
  const index = wsAllMap.findIndex(item => item.sessionID === sessionID);
  if (index >= 0) {
    return wsAllMap[index].ws;
  }
  return null;
}

wss.on('connection', (ws, req) => {


  //here we try to get the session of the WebSocket
  cookieParserInstance(req, null, function (err) {
    const sessionID = req.signedCookies['connect.sid'];
    console.log(sessionID);
    wsAllMap.push({
      sessionID: sessionID,
      ws: ws
    });
    /*mongoStore.get(sessionID, (err, session ) => {
      if(err) {
        console.error("Cannot get session for WebSocket connection", err);
        return;
      }
      console.log(session);
    });*/
  });

  ws.on('close', message => {
    wsAllMap.splice(wsAll().indexOf(ws), 1);
    SlideshowSession.deleteOne({sessionID: sessionIDForWS(ws)}).exec();
  });

  ws.on('message', message => {

    try {
      const msg = JSON.parse(message);
      switch (msg.command) {
        case "playlist":
          sendPlaylist([ws]);
          break;
        case "listImages":
          sendListFiles([ws]);
          break;
        case "setPlayerVolume":
          SlideshowSession.findById(msg.data.slideshowID, (err, slideshowSession) => {
            const ws = wsForSessionID(slideshowSession.sessionID);
            sendPlayerVolumeUpdate(msg.data.playerVolume, [ws]);
          });
          break;
        case "sessionUpdate":
          console.log(msg.data);
          const sessionID = sessionIDForWS(ws);
          const slideshowSessionObject = {
            ...msg.data,
            sessionID: sessionIDForWS(ws)
          };
          SlideshowSession.updateOne({sessionID: sessionID}, slideshowSessionObject, {
            upsert: true,
            setDefaultsOnInsert: true
          }, (err) => {
            if(err) {
              console.error("cannot create or update  SlideshowSession", err);
            }
          });
          sendSlideshowSessions(wsAll());
          break;
        case "nextSlideWish":
          SlideshowSession.findById(msg.data.slideshowID, (err, slideshowSession) => {
            const ws = wsForSessionID(slideshowSession.sessionID);
            ws.send(JSON.stringify({command: "nextSlideWish"}));
          });

          break;
        case "previousSlideWish":
          SlideshowSession.findById(msg.data.slideshowID, (err, slideshowSession) => {
            const ws = wsForSessionID(slideshowSession.sessionID);
            ws.send(JSON.stringify({command: "previousSlideWish"}));
          });

          break;
        case "videoPauseWish":
          SlideshowSession.findById(msg.data.slideshowID, (err, slideshowSession) => {
            const ws = wsForSessionID(slideshowSession.sessionID);
            ws.send(JSON.stringify({command: "videoPauseWish"}));
          });

          break;
        case "videoPlayWish":
          SlideshowSession.findById(msg.data.slideshowID, (err, slideshowSession) => {
            const ws = wsForSessionID(slideshowSession.sessionID);
            ws.send(JSON.stringify({command: "videoPlayWish"}));
          });

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
  destination: (req, file, callback) => {
    callback(null, UPLOAD_DIR);
  },
  filename: (req, file, callback) => {
    const f = file.originalname;
    const dotIndex = f.lastIndexOf(".");
    let ext = "", name = f;
    if (dotIndex > 0) {
      ext = f.substring(dotIndex, f.left);
      name = f.substring(0, f.length - ext.length);
    }
    const newFileName = name + '-' + Date.now() + ext;
    //add the MediaElement to the database
    //permanently store as ${newFileName}
    callback(null, newFileName);
  }
});

// will return a new Multer instance that can be used like a function
const upload = multer({storage: storage}).array('userFile', 10);

//serve the index page
app.get('/', (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

//the upload form post request
app.post('/api/photo', upload, (req, res) => {
  console.log(req.files);
  res.end("File has been uploaded");
  if (!Array.isArray(req.files)) return;
  let duration = parseInt(req.body.duration);
  if (!duration) {
    duration = DEFAULT_DURATION
  }
  const newMediaElements = req.files.map(file => {
    const mimeType = mime.lookup(file.path);
    return {fileName: file.filename, mimeType: mimeType, duration: duration}
  });
  MediaElement.create(newMediaElements).then((newElements) => {
    sendPlaylist(wsAll());
    sendNewElements(newElements, wsAll());
  });
});

app.delete('/api/playlist', (req, res) => {
  MediaElement.deleteMany({}, (err) => {
    if (err) throw new Error("Cannot delete playlist", err);
    sendPlaylist(wsAll());
    res.sendStatus(204);
  }).exec();
});

app.delete('/api/playlist/:id', (req, res) => {
  MediaElement.findByIdAndDelete(req.params.id, (err) => {
    if (err) throw new Error("Cannot delete file out of playlist", err);
    sendPlaylist(wsAll());
    res.sendStatus(204);
  }).exec();
});

app.post('/api/playlist/:id', (req, res) => {
  const duration = parseInt(req.body.duration);
  if (isNaN(duration)) {
    throw new Error("duration is not a number");
  }

  MediaElement.findById(req.params.id, (err, mediaFile) => {
    if (err) throw new Error("Cannot find file  inplaylist", err);
    mediaFile.duration = duration;
    mediaFile.save();
    res.sendStatus(204);
  }).exec();
});


app.delete('/api/files/:fileName', (req, res, next) => {
  let fileName = req.params.fileName;
  MediaElement.deleteOne({fileName: fileName}, (err) => {
    if (err) throw new Error("Cannot delete file out of playlist", err);
  }).exec();
  fs.unlink(`${UPLOAD_DIR}/${fileName}`, (err) => {
    if (err) throw new Error("Cannot remove file from disk", err);
    res.sendStatus(204);
  });
});

app.post('/api/playlist', (req, res) => {
  Promise.all(req.body.playlist.map(item => {
    let resolve, reject;
    let promise = new Promise((_resolve, _reject) => {
      resolve = _resolve;
      reject = _reject;
    });
    MediaElement.findById(item._id, (err, mediaFile) => {
      const orderIndex = parseInt(item.oderIndex);
      if (!isNaN(orderIndex)) return;
      mediaFile.orderIndex = item.orderIndex;
      mediaFile.save().then(resolve, reject)
    });
    return promise;
  })).then(() => {
    sendPlaylist(wsAll());
    res.sendStatus(204);
  })
});

app.put('/api/playlist/recreate', (req, res) => {
  fs.readdir(UPLOAD_DIR, (err, listing) => {
    if (err) throw new Error(`Cannot recreate playlist, because we cannot read ${UPLOAD_DIR}`, err)
    for (let fileName of listing) {
      const filePath = `${UPLOAD_DIR}/${fileName}`;
      const mimeType = mime.lookup(filePath);
      const mediaElement = new MediaElement({fileName: fileName, mimeType: mimeType, duration: DEFAULT_DURATION});
      mediaElement.save();
    }
    res.sendStatus(204);
  })
});

app.get('/api/session', (req, res) => {

});
/*app.post('/api/photo', (req, res) => {
  upload(req, res, err => {
    //req.body
    //req.files
    console.log(req.files);
    if (err) {
      return res.end("Error uploading file.");
    }
    //inform all clients about the new media elements
    sendListFiles(wsAll());
    res.end("File has been uploaded");
  });
});*/

app.get('/api/playlist', (req, res) => {
  MediaElement.find().sort({'orderIndex': 'asc'}).exec().then(playlist => res.json(playlist))
});

// this was a planed in order to launch a media player. can be omited or used
// as a reference how to start sub processes directly out of node js
let mpvChild;

app.get('/api/play', (req, res) => {
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


