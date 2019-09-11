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
const errorhandler = require('errorhandler');
const _ = require('lodash');

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
app.use(bodyParser.json());                     //we need this because we want to parse json from post requests
app.use(cookieParserInstance);                  //if we want to havea clew about the user session on a websocket
app.use(errorhandler());                //without this all errors will halt the node.js process
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

const ClientErrorSchema = new mongoose.Schema({
  sessionID: String,
  message: String,
  commit: String,
  wsClientID: {
    type: String,
    required: false
  },
  error: {
    type: Object,
    required: false
  },
  data: {type: Date, default: Date.now}
});

const ClientError = mongoose.model('ClientError', ClientErrorSchema);

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
  slideshow: {
    required: false,
    type: {
      currentMediaElementId: String,
      currentMediaElementFileName: String,
      currentMediaElementMimeType: String,
      playerVolume: Number,
      playerPos: Number,
      playerPaused: Boolean,
      slideshowPaused: Boolean
    }
  }
});
const SlideshowSession = mongoose.model('SlieshowSession', SlideshowSessionSchema);

const CommitLogSchema = new mongoose.Schema(
    {
      "commit": {type: String},
      "abbreviated_commit": {type: String},
      "tree": {type: String},
      "abbreviated_tree": {type: String},
      "parent": {type: String},
      "abbreviated_parent": {type: String},
      "refs": {type: String},
      "encoding": {type: String, required: false},
      "subject": {type: String},
      "sanitized_subject_line": {type: String},
      "body": {type: String, required: false},
      "commit_notes": {type: String, required: false},
      "verification_flag": {type: String},
      "signer": {type: String, required: false},
      "signer_key": {type: String, required: false},
      "author": {
        "name": {type: String},
        "email": {type: String},
        "date": {type: String}
      },
      "commiter": {
        "name": {type: String},
        "email": {type: String},
        "date": {type: String}
      }
    }
);

const CommitLog = mongoose.model("CommitLog", CommitLogSchema);

SlideshowSession.deleteMany({}, (err) => {
  if (err) console.error("Cannot clear slideshow sessions on startup", err);
});

/**
 * send JSON or string data  to one or more WebSocket clients
 * @param {WebSocket[]|WebSocket} ws = the WebSocket clients
 * @param {string|object} data - the data to sent, if an object is passed it will be stringified
 * @returns {null|boolean}
 */
function sendDataToWS(ws, data) {
  if (!ws) {
    console.error("Cannot send data, because Websocket is not present");
    return null;
  }
  let wsClients = ws;
  let _data = data;
  if (_.isObject(data)) _data = JSON.stringify(data);
  if (!Array.isArray(ws)) wsClients = [ws];
  for (let wsClient of wsClients) {
    try {
      wsClient.send(_data)
    } catch (e) {
      console.error("cannot send to websocket client", e)
    }
  }
  return true;
}

/**
 * send a listing of all files in the UPLOAD_DIR to all}
 * websocket clients in wsArr
 * @param {WebSocket[]|WebSocket} wsArr - the WebSocket clients
 */
function sendListFiles(wsArr) {
  fs.readdir(UPLOAD_DIR, (err, listing) => {
    if (err) {
      console.error("cannot list directory content", err);
      return;
    }
    sendDataToWS(wsArr, {command: "listImages", data: listing});
  });
}

function sendPlaylist(wsArr) {
  MediaElement.find().sort({'orderIndex': 'asc'}).exec().then(playlist => {
    sendDataToWS(wsArr, {command: "playlist", data: playlist});
  });
}

function sendSlideshowSessions(wsArr) {
  SlideshowSession.find({slideshow: {$exists: true}}).sort({'sessionID': 'asc'}).exec().then(sessions => {
    sendDataToWS(wsArr, {command: "slideshowSessions", data: sessions});
  }).catch(err => {
    console.error("cannot list slideshow sessions", err)
  });
}

function createClientError(data) {
  const {message, error, sessionID, wsClientID, commit} = data;
  const clientErrorObject = {
    message: message,
    commit: commit,
    error: error,
    wsClientID: wsClientID,
    sessionID: sessionID
  };
  console.log(JSON.stringify(clientErrorObject, null, 2));
  const clientError = new ClientError(clientErrorObject);
  return clientError.save(clientErrorObject);
}

// Websocket connection setup

const wss = new WebSocket.Server({server: server});

//each connected websocket client will be in the following array
class WebsocketClientMap {

  constructor() {
    this.wsAllMap = [];
  }

  wsAll() {
    return this.wsAllMap.map(item => item.ws);
  }

  addWebsocketClient(client) {
    this.wsAllMap.push(client);
  }

  removeWebSocketClient(ws) {
    const index = this.wsAllMap.findIndex(item => item.ws === ws);
    if (index >= 0) {
      this.wsAllMap.splice(index, 1);
    }
  }

  slideSessionIDByWS(ws) {
    const index = this.wsAllMap.findIndex(item => item.ws === ws);
    if (index >= 0) {
      return this.wsAllMap[index].slideshowSessionID;
    }
    return null;
  }

  sessionIDByWS(ws) {
    const index = this.wsAllMap.findIndex(item => item.ws === ws);
    if (index >= 0) {
      return this.wsAllMap[index].sessionID;
    }
    return null;
  }

  wsBySlideSessionID(slideSessionID) {
    const index = this.wsAllMap.findIndex(item => item.slideshowSessionID === slideSessionID);
    if (index >= 0) {
      return this.wsAllMap[index].ws;
    }
    return null;
  }

  wsBySessionID(sessionID) {
    const index = this.wsAllMap.findIndex(item => item.sessionID === sessionID);
    if (index >= 0) {
      return this.wsAllMap[index].ws;
    }
    return null;
  }

  sendBySlideSessionID(slideSessionID, data) {
    if (!slideSessionID) {
      console.error("no slide session id given");
      return null;
    }
    const ws = this.wsBySlideSessionID(slideSessionID);
    sendDataToWS(ws, data);
  }

}

const wsm = new WebsocketClientMap();

wss.on('connection', (ws, req) => {


  //here we try to get the session of the WebSocket
  cookieParserInstance(req, null, function (err) {
    if (err) {
      console.error("Cannot parse signed Cookies", err);
      return;
    }
    const sessionID = req.signedCookies['connect.sid'];
    SlideshowSession.create({sessionID: sessionID}, (err, slideshowSession) => {
      if (err) {
        console.error("Cannot create SlideshowSession in database", err);
        return;
      }
      wsm.addWebsocketClient({
        sessionID: sessionID,
        slideshowSessionID: slideshowSession._id.toString(),
        ws: ws
      });
    });
  });

  ws.on('close', message => {
    const slideSessionID = wsm.slideSessionIDByWS(ws);
    wsm.removeWebSocketClient(ws);
    if (slideSessionID) {
      SlideshowSession.deleteOne({_id: slideSessionID}, (err) => {
        if (err) {
          console.error("Cannot delete SlideshowSession even though the websocket session has ended", err);
          return;
        }
        sendSlideshowSessions(wsm.wsAll());
      });
    }
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
        case "sessionUpdate":
          //console.log(msg.data);
          const slideSessionID = wsm.slideSessionIDByWS(ws);
          SlideshowSession.findById(slideSessionID, (err, slideshowSession) => {
            if (err) {
              console.error("cannot create or update  SlideshowSession", err);
              return;
            }
            slideshowSession.slideshow = msg.data;
            slideshowSession.save((err, _slideSession) => {
              if (err) {
                console.error("cannot update SLideshowSession", err);
                return;
              }
              sendDataToWS(wsm.wsAll(), {command: "slideshowSession", data: _slideSession});
              //sendSlideshowSessions(wsm.wsAll());
            })
          });
          break;
        case "forceReloadPage":
          wsm.sendBySlideSessionID(msg.data.slideshowID, {command: "forceReloadPage"});
          break;
        case "setPlayerVolume":
          wsm.sendBySlideSessionID(msg.data.slideshowID, {command: "updatePlayerVolume", data: msg.data.playerVolume});
          break;
        case "nextSlideWish":
          wsm.sendBySlideSessionID(msg.data.slideshowID, {command: "nextSlideWish"});
          break;
        case "specificSlideWish":
          wsm.sendBySlideSessionID(msg.data.slideshowID, {command: "specificSlideWish", data: msg.data.mediaElementID});
          break;
        case "previousSlideWish":
          wsm.sendBySlideSessionID(msg.data.slideshowID, {command: "previousSlideWish"});
          break;
        case "videoPauseWish":
          wsm.sendBySlideSessionID(msg.data.slideshowID, {command: "videoPauseWish"});
          break;
        case "videoPlayWish":
          wsm.sendBySlideSessionID(msg.data.slideshowID, {command: "videoPlayWish"});
          break;
        case "slideshowPauseWish":
          wsm.sendBySlideSessionID(msg.data.slideshowID, {command: "slideshowPauseWish"});
          break;
        case "slideshowPlayWish":
          wsm.sendBySlideSessionID(msg.data.slideshowID, {command: "slideshowPlayWish"});
          break;
        case "clientError":
          const clientID = wsm.slideSessionIDByWS(ws);
          const sessionID = wsm.sessionIDByWS(ws);
          createClientError({
            ...msg.data,
            wsClientID: clientID,
            sessionID: sessionID
          });
          break;
        default: //simply ignore other messages
      }

    } catch (e) {
      console.error("An error occured while processing the websocket request", e)
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
const upload = multer({
  storage: storage,
  onError: function (err, next) {
    console.error('error uploading files', err);
    next(err);
  }
}).array('userFile', 20);

//serve the index page
app.get('/', (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

app.post('/api/error', (req, res, next) =>
    createClientError({
      ...req.body,
      sessionID: req.signedCookies['connect.sid']
    })
        .then(() => res.sendStatus(204))
        .catch(next)
);
app.get('/api/error', (req, res, next) =>
    ClientError.find({}).sort({'date': 'asc'}).exec()
        .then(clientErrors => res.json(clientErrors))
        .catch(next)
);

//the upload form post request
app.post('/api/photo', upload, (req, res, next) => new Promise(resolve => {
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
      MediaElement.create(newMediaElements, (err, newElements) => {
        if (err) {
          throw new Error("cannot create new MediaElement in DB", err);
        }
        sendPlaylist(wsm.wsAll());
        sendDataToWS(wsm.wsAll(), {command: "newElements", data: newElements});
        resolve();
      });
    }).catch(next)
);

app.delete('/api/playlist', (req, res, next) => new Promise(resolve => {
      MediaElement.deleteMany({}, (err) => {
        if (err) throw new Error("Cannot delete playlist", err);
        sendPlaylist(wsm.wsAll());
        res.sendStatus(204);
        resolve();
      });
    }).catch(next)
);

app.delete('/api/playlist/:id', (req, res, next) => new Promise(resolve => {
      MediaElement.findByIdAndDelete(req.params.id, (err) => {
        if (err) throw new Error("Cannot delete file out of playlist", err);
        sendPlaylist(wsm.wsAll());
        res.sendStatus(204);
        resolve();
      });
    }).catch(next)
);

app.post('/api/playlist/:id', (req, res, next) => new Promise(resolve => {
      const duration = parseInt(req.body.duration);
      if (isNaN(duration)) {
        throw new Error("duration is not a number");
      }

      return MediaElement.findById(req.params.id).exec().then((mediaFile) => {
        mediaFile.duration = duration;
        mediaFile.save();
        res.sendStatus(204);
        resolve();
      }).catch(next);
    }).catch(next)
);

app.put('/api/clone/playlist/:id', (req, res, next) => {
      const mediaElementID = req.params.id;
      MediaElement.findById(mediaElementID).exec().then((newMediaElement) => {
        newMediaElement._id = mongoose.Types.ObjectId();
        newMediaElement.isNew = true;
        return newMediaElement.save()
      }).then(() => {
        sendPlaylist(wsm.wsAll());
        res.sendStatus(204);
      }).catch(next)
    }
);


app.delete('/api/files/:fileName', (req, res, next) => new Promise(resolve => {
      let fileName = req.params.fileName;
      MediaElement.deleteOne({fileName: fileName}, (err) => {
        if (err) throw new Error("Cannot delete file out of playlist", err);
        fs.unlink(`${UPLOAD_DIR}/${fileName}`, (err) => {
          if (err) throw new Error(`Cannot remove file ${fileName} from disk`, err);
          res.sendStatus(204);
          resolve();
        });
      });
    }).catch(next)
);

app.post('/api/playlist', (req, res, next) =>
    Promise.all(req.body.playlist.map(item =>
        MediaElement.findById(item._id).exec().then(
            (mediaFile) => {
              const orderIndex = parseInt(item.oderIndex);
              if (!isNaN(orderIndex)) throw new Error("orderIndex is not a number");
              mediaFile.orderIndex = item.orderIndex;
              return mediaFile.save()
            })
    ))
        .then(() => {
          sendPlaylist(wsm.wsAll());
          res.sendStatus(204);
        })
        .catch(next)
);

app.put('/api/playlist/recreate', (req, res, next) => new Promise(resolve => {
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
    }).catch(next)
);

app.get('/api/session', (req, res, next) => {
  SlideshowSession.find({slideshow: {$exists: true}}).sort({'sessionID': 'asc'}).exec()
      .then(sessions => res.json(sessions))
      .catch(next);
});

app.get('/api/playlist', (req, res, next) => {
  MediaElement.find().sort({'orderIndex': 'asc'}).exec()
      .then(playlist => res.json(playlist))
      .catch(next)
});

// this was a planed in order to launch a media player. can be omited or used
// as a reference how to start sub processes directly out of node js
let mpvChild;


app.get('/public/sha.js', (req, res, next) => {
  gitLogRevHead().then(sha => {
    if(sha.length > 1) {
      sha = sha.trimEnd();
    }
    res.end(`function currentSha() { return "${sha}"; }`);
  }).catch(next);
});

app.get('/git/log/all', (req, res, next) =>
  CommitLog.find({}).sort({"comitter.data": 'asc'}).then(logEntries => {
    res.json(logEntries);
  }).catch(next)
);
app.put('/git/log/all', (req, res, next) =>
  executeProcess('git', ['log', '--pretty=format:{%n  "commit": "%H",%n  "abbreviated_commit": "%h",%n  "tree": "%T",%n  "abbreviated_tree": "%t",%n  "parent": "%P",%n  "abbreviated_parent": "%p",%n  "refs": "%D",%n  "encoding": "%e",%n  "subject": "%s",%n  "sanitized_subject_line": "%f",%n  "body": "%b",%n  "commit_notes": "%N",%n  "verification_flag": "%G?",%n  "signer": "%GS",%n  "signer_key": "%GK",%n  "author": {%n    "name": "%aN",%n    "email": "%aE",%n    "date": "%aD"%n  },%n  "commiter": {%n    "name": "%cN",%n    "email": "%cE",%n    "date": "%cD"%n  }%n},'])
      .then(data => {
        let logEntries = [];
        if(data.length > 2) {
          data =  "[ " + data.substr(0, data.length - 1) + " ]".replace(/\n/, '', 'g');
        }
        try {
          logEntries = JSON.parse(data);
        } catch (e) {
          throw new Error("Cannot parse log string " + data, e);
        }
        return Promise.all(logEntries.map(entry =>
                CommitLog.findOneAndUpdate({commit: entry.commit}, entry, {upsert: true} ).exec()
            ))
            .then(() => {
              res.sendStatus(204);
            })
        }).catch(next)
);

function executeProcess(command, params) {
  return new Promise((resolve, reject) => {

    const gitProcess = spawn(command, params);
    let logString = "";
    let error = null;
    gitProcess.stdout.on('data', (data) => {
      //console.log(`stdout: ${data}`);
        logString += data.toString();
    });

    gitProcess.stderr.on('data', (data) => {
      console.error(`stderr: ${data}`);
      error = data;
    });
    gitProcess.on('close', (code) => {
      console.log(`child process exited with code ${code}`);
      if(code === 0) {
        resolve(logString);
      } else {
          reject(new Error("Process exited with " + code));
      }
    });
  })
}

function gitLogRevHead() {
  return  executeProcess('git', [ 'rev-parse', 'HEAD']);

}

let playerProcessLaunched = false;

app.get('/api/shutdown/', (req, res, next) => {
  executeProcess('sudo', ['shutdown', '10']).then(() => {
    res.send(204);
  }).catch(next)
});

app.put('/api/play/:id', (req, res, next) => {
  //fs.readFile("")
  if(playerProcessLaunched) {
    res.sendStatus(423);
    return;
  }
  const id = req.params.id;
  const sessionID = req.signedCookies['connect.sid'];
  MediaElement.findById(id).exec().then( (mediaElement) => {
    res.sendStatus(204);
    playerProcessLaunched = true;
    return executeProcess('/usr/bin/mplayer', ['-fs', `file://${UPLOAD_DIR}/${mediaElement.fileName}`] ).finally(() => {
      playerProcessLaunched = false;
      if(sessionID) {
        const ws = wsm.wsBySessionID(sessionID);
        if(ws) {
          sendDataToWS(ws, {
            command: 'externalPlayFinish',
            data: { mediaElementID: id }});
        } else {
          logError(`No WebSocket found for Session ${sessionID}`);
        }
      }
    });
  }).catch(next);
  //mpvChild = spawn('/usr/bin/mplayer', [-/*"--image-display-duration=12",*/ `${UPLOAD_DIR}/*.jpg`]);

});


