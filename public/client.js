const wsAddr = 'ws://' + location.hostname + (location.port ? ':' + location.port : '');
const baseAddr = 'http://' + location.hostname + (location.port ? ':' + location.port : '');
let ws;
const uploadPath = "/uploads/";

function logError(message, err) {
  console.error(message, err);
  const errorObj = JSON.parse(JSON.stringify(err, Object.getOwnPropertyNames(err)));
  try {
    const data = { commit: currentSha(), message: message, error: errorObj };
    sendCommand("clientError", data);
    _postData("/api/error", data);
  } catch (e) {
  }

}

function _postData(url, jsObject) {

  return fetch(url, {
    headers: {
      'Content-Type': 'application/json'
    },
    method: 'POST',
    body: JSON.stringify(jsObject)
  });
}

function invokeExternalPlay(id) {
  return fetch(baseAddr + "/api/play/" + id, {method: 'PUT'});
}

function shutdownPi() {
  return fetch(baseAddr + "/api/shutdown")
}
function rebootPi() {
  return fetch(baseAddr + "/api/reboot")
}
function restartBrowser() {
  return fetch(baseAddr + "/api/browser/restart")
}

function lsFiles(path) {
  return fetch( baseAddr + '/api/storage/' + path)
}

function updateFile(fileId, fields) {
  return _postData(baseAddr + "/api/playlist/" + fileId, fields)
}

function deleteFile(fileName) {
  return fetch(baseAddr + "/api/files/" + fileName, {method: 'DELETE'});
}

function cloneMediaElement(id) {
  return fetch(baseAddr + "/api/clone/playlist/" + id, {method: 'PUT'});
}
function removeMediaElementFromPlaylist(id) {
  return fetch(baseAddr + "/api/playlist/" + id, {method: 'DELETE'});
}

function updatePlaylistOrder(playlist) {
  return _postData(baseAddr + "/api/playlist", {
    playlist: playlist
  })
}

function getPlaylist() {
  return fetch(baseAddr + "/api/playlist");
}

function getSessions() {
  return fetch(baseAddr + "/api/session");
}

function listStorage(path) {
  return fetch(baseAddr + "/api/storage/" + path)
}

function emitResult(cb, eventName, fieldName) {
  return cb()
      .then(res => res.json())
      .then(resultJson => {
        const detail = {};
        detail[fieldName] = resultJson;
        document.dispatchEvent(
            new CustomEvent(eventName, {detail: detail}));
      })
}

function sendJSON(data) {
  if (ws) {
    ws.send(JSON.stringify(data));
  }
}

function sendCommand(cmd, data) {
  sendJSON({command: cmd, data: data})
}

emitResult(getPlaylist, "playlist-updated", "playlist")
    .then(() => {
      ws = new RobustWebSocket(wsAddr);
      ws.addEventListener("message", message => {
        try {
          const msg = JSON.parse(message.data)
          switch (msg.command) {
            case "playlist":
              if (!Array.isArray(msg.data)) return;
              document.dispatchEvent(
                  new CustomEvent("playlist-updated", {detail: {playlist: msg.data}})
              );
              break;
            case "newElements":
              if (!Array.isArray(msg.data)) return;
              document.dispatchEvent(
                  new CustomEvent("new-elements-added", {detail: {newElements: msg.data}})
              );
              break;
            case "slideshowSessions":
              if (!Array.isArray(msg.data)) return;
              document.dispatchEvent(
                  new CustomEvent("sessions-updated", {detail: {sessions: msg.data}})
              );
              break;
            case "slideshowSession":
              document.dispatchEvent(
                  new CustomEvent("session-updated", {detail: {session: msg.data}})
              );
              break;
            case "updatePlayerVolume":
              document.dispatchEvent(
                  new CustomEvent("player-volume-updated", {detail: {volume: msg.data}})
              );
              break;
            case "nextSlideWish":
              document.dispatchEvent(
                  new CustomEvent("next-slide-wish")
              );
              break;
            case "previousSlideWish":
              document.dispatchEvent(
                  new CustomEvent("previous-slide-wish")
              );
              break;
            case "specificSlideWish":
              document.dispatchEvent(
                  new CustomEvent("specific-slide-wish", {detail: {mediaElementID: msg.data}})
              );
              break;
            case "videoPlayWish":
              document.dispatchEvent(
                  new CustomEvent("video-play-wish", {detail: {volume: msg.data}})
              );
              break;
            case "videoPauseWish":
              document.dispatchEvent(
                  new CustomEvent("video-pause-wish")
              );
              break;
            case "slideshowPlayWish":
              document.dispatchEvent(
                  new CustomEvent("slideshow-play-wish")
              );
              break;
            case "slideshowPauseWish":
              document.dispatchEvent(
                  new CustomEvent("slideshow-pause-wish")
              );
              break;
            case "listImages":
              if (!Array.isArray(msg.data)) return;
              document.dispatchEvent(
                  new CustomEvent("images-updated", {detail: {images: msg.data}})
              );
              break;
            case "externalPlayFinish":
              document.dispatchEvent(
                  new CustomEvent("external-play-finish", {detail: msg.data})
              );
              break;
            case "forceReloadPage":
              window.location.reload();
              break;
            default:
          }
        } catch (err) {
          logError("some error occured processing websocket message", err)
        }
      });

      ws.addEventListener("open", () => {
        console.log("opened web socket");
      });
    });

