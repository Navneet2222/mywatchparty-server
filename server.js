const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// CORS configuration for production
// --- WILDCARD CORS CONFIGURATION ---
app.use(cors({
  origin: "*", // Allows any Vercel preview link to connect
  methods: ["GET", "POST"]
}));

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Room State Tracking
const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // --- CORE ROOM EVENTS ---
  
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
    io.in(data.roomId).emit('new-message', data);
  });

  // --- WebRTC SIGNALING EVENTS ---
  
  // 1. When a user wants to initiate a call
  socket.on('sending-signal', payload => {
    io.to(payload.userToSignal).emit('user-joined-rtc', { 
      signal: payload.signal, 
      callerID: payload.callerID,
      username: payload.username 
    });
  });

  // 2. When the other user accepts the call
  socket.on('returning-signal', payload => {
    io.to(payload.callerID).emit('receiving-returned-signal', { 
      signal: payload.signal, 
      id: socket.id 
    });
  });

  // --- DISCONNECT EVENT ---
  
  // Handle user disconnecting from voice/video and leaving the room
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    // Notify the room so they can remove the video element and clean up the state
    rooms.forEach((roomData, roomId) => {
      const participantIndex = roomData.participants.findIndex(p => p.id === socket.id);
      
      if (participantIndex !== -1) {
        roomData.participants.splice(participantIndex, 1);
        socket.to(roomId).emit('user-disconnected', socket.id);
        
        // Optional: If the room is empty, delete it from the Map to free up memory
        if (roomData.participants.length === 0) {
          rooms.delete(roomId);
        }
      }
    });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Mywatchparty server active on port ${PORT}`);
});