// backend/server.ts
// Compatible with Deno Deploy WebSocket

interface Player {
  id: string;
  name: string;
  ws: WebSocket;
  roomId: string;
  markedNumbers: number[];
}

interface GameRoom {
  id: string;
  players: Map<string, Player>;
  calledNumbers: number[];
}

const rooms = new Map<string, GameRoom>();

Deno.serve((req) => {
  // WebSocket upgrade check
  if (req.headers.get("upgrade") !== "websocket") {
    return new Response("WebSocket only", { status: 400 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.onopen = () => {
    console.log("Client connected");
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);

    // JOIN ROOM
    if (data.type === "join") {
      const { roomId, playerId, name } = data;

      if (!rooms.has(roomId)) {
        rooms.set(roomId, {
          id: roomId,
          players: new Map(),
          calledNumbers: [],
        });
      }

      const room = rooms.get(roomId)!;

      room.players.set(playerId, {
        id: playerId,
        name,
        ws: socket,
        roomId,
        markedNumbers: [],
      });

      broadcast(roomId, {
        type: "players",
        players: [...room.players.values()].map(p => p.name),
      });
    }

    // CALL NUMBER
    if (data.type === "call") {
      const room = rooms.get(data.roomId);
      if (!room) return;

      room.calledNumbers.push(data.number);

      broadcast(data.roomId, {
        type: "number",
        number: data.number,
      });
    }
  };

  socket.onclose = () => {
    console.log("Client disconnected");
  };

  return response;
});

// Broadcast helper
function broadcast(roomId: string, message: unknown) {
  const room = rooms.get(roomId);
  if (!room) return;

  for (const player of room.players.values()) {
    player.ws.send(JSON.stringify(message));
  }
}
