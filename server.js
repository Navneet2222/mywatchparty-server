const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// CORS configuration for production
const allowedOrigins = [
  const allowedOrigins = [
  "http://localhost:5173", 
  "https://mywatchparty-client.vercel.app/" // PASTE YOUR LINK HERE (No trailing slash / at the end)
];

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST"],
  credentials: true
}));

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Room State Tracking
const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Joining a room
  socket.on('join-room', (roomId, username) => {
    socket.join(roomId);
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, { host: socket.id, participants: [] });
    }
    
    rooms.get(roomId).participants.push({ id: socket.id, name: username });
    
    // Notify others
    socket.to(roomId).emit('user-joined', { id: socket.id, name: username });
    
    // Send current room state to the newcomer
    socket.emit('room-state', rooms.get(roomId));
    
    console.log(`${username} joined room: ${roomId}`);
  });

  // Synchronization Events
  socket.on('video-play', (data) => {
    // data: { roomId, currentTime }
    socket.to(data.roomId).emit('sync-play', data);
  });

  socket.on('video-pause', (data) => {
    socket.to(data.roomId).emit('sync-pause');
  });

  socket.on('video-seek', (data) => {
    socket.to(data.roomId).emit('sync-seek', data.currentTime);
  });

  // Chat Messaging
  socket.on('send-message', (data) => {
    // data: { roomId, text, sender }
    io.in(data.roomId).emit('new-message', data);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    // Room cleanup logic would go here
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Mywatchparty server active on port ${PORT}`);
});