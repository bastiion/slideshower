const wsAddr = 'ws://'+location.hostname+(location.port ? ':'+location.port: '');
const ws = new WebSocket(wsAddr);
const uploadPath = "/uploads/";
let images = [];
let imageIndex = 0;


function sendJSON(data) {
  ws.send(JSON.stringify(data)) ;
}
function sendCommand(cmd, data) {
  sendJSON({command: cmd, data: data})
}
ws.addEventListener("message", (msg) => {
  console.log(msg.data);
  try {
    const message = JSON.parse(msg.data)
    switch (message.command) {
      case "listImages":
        if(Array.isArray(message.data)) {
          images = message.data;
        }
        break;
      default:
    }
  } catch (e) {

  }
});
ws.addEventListener("open",() => {
  console.log("opened web socket");
  sendCommand("listImages");
});
