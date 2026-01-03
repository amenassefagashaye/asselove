// server.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { WebSocket, WebSocketClient } from "https://deno.land/x/websocket@v0.1.4/mod.ts";

// Types
interface Player {
  id: string;
  name: string;
  phone: string;
  stake: number;
  boardId: number;
  gameType: string;
  payment: number;
  balance: number;
  won: number;
  ws: WebSocket;
  roomId: string;
  markedNumbers: Set<number>;
}

interface GameRoom {
  id: string;
  gameType: string;
  players: Map<string, Player>;
  calledNumbers: number[];
  currentNumber: number | null;
  isCalling: boolean;
  gameActive: boolean;
  callInterval: number | null;
}

// Game State
const rooms = new Map<string, GameRoom>();
const players = new Map<string, Player>();
const boardTypes = [
  { id: '75ball', name: '75-ቢንጎ', range: 75 },
  { id: '90ball', name: '90-ቢንጎ', range: 90 },
  { id: '30ball', name: '30-ቢንጎ', range: 30 },
  { id: '50ball', name: '50-ቢንጎ', range: 50 },
  { id: 'pattern', name: 'ንድፍ ቢንጎ', range: 75 },
  { id: 'coverall', name: 'ሙሉ ቤት', range: 90 }
];

// Helper Functions
function generatePlayerId(): string {
  return `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateRoomId(): string {
  return `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function calculatePotentialWin(stake: number): number {
  const validMembers = 90;
  const potential = (0.8 * validMembers * stake * 0.97);
  return Math.floor(potential);
}

function getDisplayNumber(number: number, gameType: string): string {
  if (gameType === '75ball' || gameType === 'pattern') {
    const letters = 'BINGO';
    const columnSize = 15;
    const columnIndex = Math.floor((number - 1) / columnSize);
    const letter = letters[Math.min(columnIndex, 4)];
    return `${letter}-${number}`;
  } else if (gameType === '50ball') {
    const columnSize = 10;
    const columnIndex = Math.floor((number - 1) / columnSize);
    const letters = 'BINGO';
    const letter = letters[Math.min(columnIndex, 4)];
    return `${letter}-${number}`;
  } else {
    return number.toString();
  }
}

// Handle WebSocket connections
async function handleWs(ws: WebSocket) {
  console.log('New WebSocket connection');
  
  ws.on("message", (message: string) => {
    try {
      const data = JSON.parse(message);
      handleMessage(ws, data);
    } catch (error) {
      console.error('Error parsing message:', error);
      sendError(ws, 'Invalid message format');
    }
  });
  
  ws.on("close", () => {
    console.log('WebSocket closed');
    handleDisconnect(ws);
  });
  
  ws.on("error", (error: Error) => {
    console.error('WebSocket error:', error);
    handleDisconnect(ws);
  });
}

function handleMessage(ws: WebSocket, data: any) {
  const { type, playerId, roomId, ...payload } = data;
  
  switch (type) {
    case 'register_player':
      handleRegisterPlayer(ws, payload);
      break;
      
    case 'mark_number':
      handleMarkNumber(playerId, roomId, payload.number);
      break;
      
    case 'announce_win':
      handleAnnounceWin(playerId, roomId, payload);
      break;
      
    case 'start_calling':
      handleStartCalling(roomId);
      break;
      
    case 'stop_calling':
      handleStopCalling(roomId);
      break;
      
    case 'get_game_state':
      handleGetGameState(playerId, roomId);
      break;
      
    case 'withdraw':
      handleWithdraw(playerId, roomId, payload);
      break;
      
    default:
      sendError(ws, `Unknown message type: ${type}`);
  }
}

function handleRegisterPlayer(ws: WebSocket, data: any) {
  const { name, phone, stake, boardId, gameType, payment } = data;
  
  if (!name || !phone || !stake || !gameType) {
    sendError(ws, 'Missing required registration data');
    return;
  }
  
  const playerId = generatePlayerId();
  const roomId = getOrCreateRoom(gameType);
  
  const player: Player = {
    id: playerId,
    name,
    phone,
    stake: parseInt(stake),
    boardId: parseInt(boardId) || 1,
    gameType,
    payment: parseInt(payment) || 0,
    balance: parseInt(payment) || 0,
    won: 0,
    ws,
    roomId,
    markedNumbers: new Set()
  };
  
  players.set(playerId, player);
  
  const room = rooms.get(roomId)!;
  room.players.set(playerId, player);
  
  // Send player connection confirmation
  ws.send(JSON.stringify({
    type: 'player_connected',
    playerId,
    roomId
  }));
  
  // Notify other players in the room
  broadcastToRoom(roomId, {
    type: 'player_joined',
    players: Array.from(room.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      stake: p.stake
    }))
  }, playerId);
  
  console.log(`Player ${name} joined room ${roomId}`);
}

function getOrCreateRoom(gameType: string): string {
  // Find existing room with same game type and available slots
  for (const [roomId, room] of rooms) {
    if (room.gameType === gameType && room.players.size < 90) {
      return roomId;
    }
  }
  
  // Create new room
  const roomId = generateRoomId();
  const room: GameRoom = {
    id: roomId,
    gameType,
    players: new Map(),
    calledNumbers: [],
    currentNumber: null,
    isCalling: false,
    gameActive: true,
    callInterval: null
  };
  
  rooms.set(roomId, room);
  console.log(`Created new room ${roomId} for game type ${gameType}`);
  
  return roomId;
}

function handleMarkNumber(playerId: string, roomId: string, number: number) {
  const player = players.get(playerId);
  if (!player || player.roomId !== roomId) {
    return;
  }
  
  player.markedNumbers.add(number);
  
  // Broadcast mark to room (optional)
  broadcastToRoom(roomId, {
    type: 'number_marked',
    playerId,
    number
  }, playerId);
}

function handleAnnounceWin(playerId: string, roomId: string, data: any) {
  const player = players.get(playerId);
  const room = rooms.get(roomId);
  
  if (!player || !room) {
    return;
  }
  
  const winAmount = calculatePotentialWin(player.stake);
  player.won += winAmount;
  player.balance += winAmount;
  
  // Broadcast win announcement
  broadcastToRoom(roomId, {
    type: 'win_announced',
    winnerName: player.name,
    pattern: data.pattern,
    winAmount
  });
  
  console.log(`Player ${player.name} won ${winAmount} with pattern ${data.pattern}`);
  
  // Reset game for this player
  player.markedNumbers.clear();
  
  // Send updated balance to winner
  player.ws.send(JSON.stringify({
    type: 'balance_updated',
    balance: player.balance,
    won: player.won
  }));
}

function handleStartCalling(roomId: string) {
  const room = rooms.get(roomId);
  if (!room || room.isCalling) {
    return;
  }
  
  room.isCalling = true;
  
  // Start calling numbers every 7 seconds
  room.callInterval = setInterval(() => {
    callNextNumber(roomId);
  }, 7000);
  
  // Immediately call first number
  setTimeout(() => callNextNumber(roomId), 1000);
}

function handleStopCalling(roomId: string) {
  const room = rooms.get(roomId);
  if (!room || !room.isCalling) {
    return;
  }
  
  room.isCalling = false;
  if (room.callInterval) {
    clearInterval(room.callInterval);
    room.callInterval = null;
  }
}

function callNextNumber(roomId: string) {
  const room = rooms.get(roomId);
  if (!room || !room.isCalling) {
    return;
  }
  
  const boardType = boardTypes.find(t => t.id === room.gameType);
  if (!boardType) {
    return;
  }
  
  let number: number;
  do {
    number = Math.floor(Math.random() * boardType.range) + 1;
  } while (room.calledNumbers.includes(number));
  
  room.calledNumbers.push(number);
  room.currentNumber = number;
  
  const displayText = getDisplayNumber(number, room.gameType);
  
  // Broadcast to all players in room
  broadcastToRoom(roomId, {
    type: 'number_called',
    number,
    displayText,
    calledNumbers: room.calledNumbers.slice(-10) // Last 10 numbers
  });
  
  // Check for winners after each call
  checkForWinners(roomId);
}

function checkForWinners(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }
  
  // In a real implementation, you would check each player's board
  // against winning patterns. This is simplified.
  // For now, we'll just check if any player has marked all called numbers
  // (which would be a full house win)
  
  for (const player of room.players.values()) {
    // Check if player has marked all current called numbers
    // This is a simplified win check
    if (room.calledNumbers.every(num => player.markedNumbers.has(num))) {
      // Player wins!
      const winAmount = calculatePotentialWin(player.stake);
      
      broadcastToRoom(roomId, {
        type: 'win_announced',
        winnerName: player.name,
        pattern: 'full-house',
        winAmount
      });
      
      player.won += winAmount;
      player.balance += winAmount;
      
      // Send balance update to winner
      player.ws.send(JSON.stringify({
        type: 'balance_updated',
        balance: player.balance,
        won: player.won
      }));
      
      // Reset player's marked numbers after win
      player.markedNumbers.clear();
    }
  }
}

function handleGetGameState(playerId: string, roomId: string) {
  const player = players.get(playerId);
  const room = rooms.get(roomId);
  
  if (!player || !room) {
    return;
  }
  
  player.ws.send(JSON.stringify({
    type: 'game_state',
    state: {
      calledNumbers: room.calledNumbers,
      currentNumber: room.currentNumber ? 
        getDisplayNumber(room.currentNumber, room.gameType) : null,
      isCalling: room.isCalling,
      gameActive: room.gameActive,
      playersCount: room.players.size
    }
  }));
}

function handleWithdraw(playerId: string, roomId: string, data: any) {
  const player = players.get(playerId);
  if (!player) {
    return;
  }
  
  const { account, amount } = data;
  
  if (!account || amount < 25) {
    sendError(player.ws, 'Invalid withdrawal request');
    return;
  }
  
  if (amount > player.balance) {
    sendError(player.ws, 'Insufficient balance');
    return;
  }
  
  // Process withdrawal (in real app, this would integrate with payment gateway)
  player.balance -= amount;
  
  player.ws.send(JSON.stringify({
    type: 'withdrawal_processed',
    amount,
    newBalance: player.balance,
    transactionId: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }));
  
  console.log(`Player ${player.name} withdrew ${amount}, new balance: ${player.balance}`);
}

function handleDisconnect(ws: WebSocket) {
  // Find player by WebSocket
  let disconnectedPlayer: Player | null = null;
  let roomId: string | null = null;
  
  for (const player of players.values()) {
    if (player.ws === ws) {
      disconnectedPlayer = player;
      roomId = player.roomId;
      break;
    }
  }
  
  if (disconnectedPlayer && roomId) {
    // Remove player from room
    const room = rooms.get(roomId);
    if (room) {
      room.players.delete(disconnectedPlayer.id);
      
      // Notify other players
      broadcastToRoom(roomId, {
        type: 'player_left',
        playerId: disconnectedPlayer.id,
        players: Array.from(room.players.values()).map(p => ({
          id: p.id,
          name: p.name
        }))
      });
      
      // If room is empty, clean it up
      if (room.players.size === 0) {
        if (room.callInterval) {
          clearInterval(room.callInterval);
        }
        rooms.delete(roomId);
        console.log(`Room ${roomId} removed (empty)`);
      }
    }
    
    // Remove player from global map
    players.delete(disconnectedPlayer.id);
    
    console.log(`Player ${disconnectedPlayer.name} disconnected`);
  }
}

function broadcastToRoom(roomId: string, message: any, excludePlayerId?: string) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }
  
  const messageStr = JSON.stringify(message);
  
  for (const player of room.players.values()) {
    if (player.id !== excludePlayerId && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(messageStr);
    }
  }
}

function sendError(ws: WebSocket, message: string) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'error',
      message
    }));
  }
}

// Main HTTP Server
const handler = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  
  // Handle WebSocket upgrade
  if (req.headers.get("upgrade") === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    
    // Convert Deno WebSocket to compatible WebSocket
    const ws = new WebSocket(socket);
    handleWs(ws);
    
    return response;
  }
  
  // Serve static files (for frontend)
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const html = await Deno.readTextFile("./index.html");
    return new Response(html, {
      headers: { "content-type": "text/html" },
    });
  }
  
  // API endpoints
  if (url.pathname === "/api/stats") {
    const stats = {
      totalPlayers: players.size,
      totalRooms: rooms.size,
      rooms: Array.from(rooms.values()).map(room => ({
        id: room.id,
        gameType: room.gameType,
        playerCount: room.players.size,
        isCalling: room.isCalling
      }))
    };
    
    return new Response(JSON.stringify(stats), {
      headers: { "content-type": "application/json" },
    });
  }
  
  if (url.pathname === "/api/players") {
    const playersList = Array.from(players.values()).map(p => ({
      id: p.id,
      name: p.name,
      phone: p.phone,
      stake: p.stake,
      balance: p.balance,
      won: p.won,
      roomId: p.roomId
    }));
    
    return new Response(JSON.stringify(playersList), {
      headers: { "content-type": "application/json" },
    });
  }
  
  // Default response
  return new Response("AGBDBG Server is running", {
    headers: { "content-type": "text/plain" },
  });
};

// Start server
console.log("AGBDBG Server starting on http://localhost:8080");
serve(handler, { port: 8080 });