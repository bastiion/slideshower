const wsAddr = 'ws://' + location.hostname + (location.port ? ':' + location.port : '');
const baseAddr = 'http://' + location.hostname + (location.port ? ':' + location.port : '');
const ws = new WebSocket(wsAddr);
const uploadPath = "/uploads/";


function deleteFile(fileName) {
  return fetch(baseAddr + "/api/files/" + fileName, {method: 'DELETE'});
}

function sendJSON(data) {
  ws.send(JSON.stringify(data));
}

function sendCommand(cmd, data) {
  sendJSON({command: cmd, data: data})
}

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
