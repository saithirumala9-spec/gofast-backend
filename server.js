require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

// Firebase Admin
let firebaseApp;
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}');
  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('✅ Firebase initialized');
} catch (error) {
  console.error('❌ Firebase init error:', error.message);
}

// MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// Socket.IO
const io = socketIO(server, {
  cors: { origin: "*" }
});

io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);
  
  socket.on('driver:location', (data) => {
    io.emit('driver:location:update', data);
  });
  
  socket.on('ride:request', (data) => {
    io.emit('ride:new', data);
  });
  
  socket.on('ride:status:update', (data) => io.emit('ride:status:changed', data));
  socket.on('disconnect', () => console.log('🔌 Disconnected'));
});

// Routes
app.get('/', (req, res) => {
  res.json({
    status: 'success',
    message: 'GoFast Backend API',
    version: '1.0.0'
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    firebase: firebaseApp ? 'initialized' : 'not initialized'
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`GoFast Backend running on port ${PORT}`);
});
