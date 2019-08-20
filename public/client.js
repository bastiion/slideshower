const wsAddr = 'ws://' + location.hostname + (location.port ? ':' + location.port : '');
const baseAddr = 'http://' + location.hostname + (location.port ? ':' + location.port : '');
let ws;
const uploadPath = "/uploads/";

function _postData(url, jsObject) {

  return fetch(url, {
    headers: {
      'Content-Type': 'application/json'
    },
    method: 'POST',
    body: JSON.stringify(jsObject)
  });
}

function updateFile(fileId, fields) {
  return _postData(baseAddr + "/api/playlist/" + fileId, fields)
}

function deleteFile(fileName) {
  return fetch(baseAddr + "/api/files/" + fileName, {method: 'DELETE'});
}

function updatePlaylistOrder(playlist) {
  return _postData(baseAddr + "/api/playlist", {
    playlist: playlist
  })
}

function getPlaylist() {
  return fetch(baseAddr + "/api/playlist");
}

function sendJSON(data) {
  if(ws) {
    ws.send(JSON.stringify(data));
  }
}

function sendCommand(cmd, data) {
  sendJSON({command: cmd, data: data})
}

getPlaylist().then((res) => {
  return res.json();
}).then((playlist) => {
  document.dispatchEvent(
      new CustomEvent("playlist-updated", {detail: {playlist: playlist}})
  );
  ws = new WebSocket(wsAddr);
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
        case "videoPlayWish":
          document.dispatchEvent(
              new CustomEvent("video-play-wish")
          );
          break;
        case "videoPauseWish":
          document.dispatchEvent(
              new CustomEvent("video-pause-wish")
          );
          break;
        case "listImages":
          if (!Array.isArray(msg.data)) return;
          document.dispatchEvent(
              new CustomEvent("images-updated", {detail: {images: msg.data}})
          );
          break;
        default:
      }
    } catch (e) {

    }
  });

  ws.addEventListener("open", () => {
    console.log("opened web socket");
    sendCommand("playlist");
  });
});

