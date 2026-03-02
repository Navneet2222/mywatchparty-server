const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);

// --- WILDCARD CORS CONFIGURATION ---
const corsOptions = {
  origin: "*",
  methods: ["GET", "POST"],
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

// --- FILE UPLOAD SETUP (50MB Limit) ---
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    // Append timestamp to prevent filename collisions
    cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '-'));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB strictly enforced
});

// Serve uploaded files securely so the frontend can play them
app.use('/uploads', express.static(uploadDir));

// Upload Endpoint
app.post('/api/upload', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded.');
  
  // Return the path so the frontend can broadcast it
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});

// --- 24-HOUR AUTO-DELETE CRON JOB ---
// Runs every hour to check for old files
setInterval(() => {
  fs.readdir(uploadDir, (err, files) => {
    if (err) return console.error('Cleanup read error:', err);
    
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;

    files.forEach(file => {
      const filePath = path.join(uploadDir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        // If file is older than 24 hours, delete it
        if (now - stats.mtimeMs > twentyFourHours) {
          fs.unlink(filePath, err => {
            if (!err) console.log(`Auto-deleted old file: ${file}`);
          });
        }
      });
    });
  });
}, 60 * 60 * 1000); // Check every 60 minutes


// --- SOCKET.IO ROOM ENGINE ---
const io = new Server(server, { cors: corsOptions });
const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // 1. Joining a room (Now includes Video State)
  socket.on('join-room', (roomId, username, initialVideoState = null) => {
    socket.join(roomId);
    
    // If room doesn't exist, create it and set the host's video state
    if (!rooms.has(roomId)) {
      rooms.set(roomId, { 
        host: socket.id, 
        participants: [],
        videoState: initialVideoState // { type: 'cloud'|'hosted'|'local', url: '...' }
      });
    }
    
    const room = rooms.get(roomId);
    room.participants.push({ id: socket.id, name: username });
    
    // Notify others
    socket.to(roomId).emit('user-joined', { id: socket.id, name: username });
    
    // Send full room state (including the video link!) to the newcomer
    socket.emit('room-state', room);
  });

  // 2. Synchronization Events
  socket.on('video-play', (data) => socket.to(data.roomId).emit('sync-play', data));
  socket.on('video-pause', (data) => socket.to(data.roomId).emit('sync-pause'));
  socket.on('video-seek', (data) => socket.to(data.roomId).emit('sync-seek', data.currentTime));
  
  // 3. Chat Messaging
  socket.on('send-message', (data) => io.in(data.roomId).emit('new-message', data));

  // 4. WebRTC Signaling
  socket.on('sending-signal', payload => {
    io.to(payload.userToSignal).emit('user-joined-rtc', { 
      signal: payload.signal, callerID: payload.callerID, username: payload.username 
    });
  });
  socket.on('returning-signal', payload => {
    io.to(payload.callerID).emit('receiving-returned-signal', { signal: payload.signal, id: socket.id });
  });

  // 5. Disconnect Cleanup
  socket.on('disconnect', () => {
    rooms.forEach((roomData, roomId) => {
      const participantIndex = roomData.participants.findIndex(p => p.id === socket.id);
      if (participantIndex !== -1) {
        roomData.participants.splice(participantIndex, 1);
        socket.to(roomId).emit('user-disconnected', socket.id);
        if (roomData.participants.length === 0) rooms.delete(roomId);
      }
    });
  });
});

// Simple health check route
app.get('/', (req, res) => res.send('Mywatchparty Backend with File Uploads is Live!'));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server active on port ${PORT}`));