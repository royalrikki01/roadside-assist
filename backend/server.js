require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('./models/User');
const Request = require('./models/Request');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE']
  }
});

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/technicians', require('./routes/technicians'));
app.use('/api/requests', require('./routes/requests'));

app.get('/api', (req, res) => res.json({ message: 'Roadside Assist API chal raha hai!' }));

// Fallback - serve index.html for any other route (for SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Online users track karna
const onlineUsers = new Map(); // userId -> socketId

// Socket.io
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // User authenticate karo
  socket.on('authenticate', async (token) => {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      if (!user) return;

      socket.userId = user._id.toString();
      socket.userRole = user.role;
      onlineUsers.set(user._id.toString(), socket.id);

      socket.emit('authenticated', { userId: user._id, name: user.name, role: user.role });
      console.log(`${user.name} (${user.role}) online`);
    } catch (err) {
      socket.emit('auth-error', 'Invalid token');
    }
  });

  // Real-time location update
  socket.on('update-location', async (data) => {
    if (!socket.userId) return;
    const { lat, lng } = data;

    // DB mein location save karo
    await User.findByIdAndUpdate(socket.userId, {
      location: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] }
    });

    // Agar technician hai toh owner ko location bhejo
    if (socket.userRole === 'technician') {
      const activeRequest = await Request.findOne({
        technician: socket.userId,
        status: { $in: ['accepted', 'in-progress'] }
      });
      if (activeRequest) {
        const ownerSocketId = onlineUsers.get(activeRequest.owner.toString());
        if (ownerSocketId) {
          io.to(ownerSocketId).emit('technician-location', { lat, lng, technicianId: socket.userId });
        }
      }
    }

    // Agar owner hai toh technician ko location bhejo (owner move kare toh)
    if (socket.userRole === 'owner') {
      const activeRequest = await Request.findOne({
        owner: socket.userId,
        status: { $in: ['accepted', 'in-progress'] }
      });
      if (activeRequest && activeRequest.technician) {
        const techSocketId = onlineUsers.get(activeRequest.technician.toString());
        if (techSocketId) {
          io.to(techSocketId).emit('owner-location', { lat, lng, ownerId: socket.userId });
        }
      }
    }
  });

  // Naya SOS request — nearby technicians ko notify karo
  socket.on('new-request', async (requestId) => {
    try {
      const request = await Request.findById(requestId).populate('owner', 'name phone');
      if (!request) return;

      const [lng, lat] = request.ownerLocation.coordinates;

      // Nearby technicians dhundo
      const nearbyTechs = await User.find({
        role: 'technician',
        isAvailable: true,
        location: {
          $near: {
            $geometry: { type: 'Point', coordinates: [lng, lat] },
            $maxDistance: 15000  // 15 km
          }
        }
      }).select('_id name');

      // Har nearby technician ko notify karo
      nearbyTechs.forEach(tech => {
        const techSocketId = onlineUsers.get(tech._id.toString());
        if (techSocketId) {
          io.to(techSocketId).emit('new-request-nearby', {
            requestId: request._id,
            ownerName: request.owner.name,
            ownerPhone: request.owner.phone,
            vehicleType: request.vehicleType,
            problemType: request.problemType,
            description: request.description,
            address: request.address,
            location: { lat, lng }
          });
        }
      });

      console.log(`Request ${requestId} ke liye ${nearbyTechs.length} technicians notify kiye`);
    } catch (err) {
      console.error('new-request error:', err);
    }
  });

  // Request accept notification — owner ko batao
  socket.on('request-accepted', async (requestId) => {
    try {
      const request = await Request.findById(requestId)
        .populate('technician', 'name phone skills rating location');
      if (!request) return;

      const ownerSocketId = onlineUsers.get(request.owner.toString());
      if (ownerSocketId) {
        io.to(ownerSocketId).emit('request-accepted-by-tech', {
          requestId,
          technician: {
            id: request.technician._id,
            name: request.technician.name,
            phone: request.technician.phone,
            skills: request.technician.skills,
            rating: request.technician.rating,
            location: request.technician.location?.coordinates
          }
        });
      }
    } catch (err) {
      console.error('request-accepted error:', err);
    }
  });

  // Chat message
  socket.on('send-message', async (data) => {
    try {
      const { requestId, text } = data;
      if (!socket.userId || !text?.trim()) return;

      const user = await User.findById(socket.userId).select('name role');
      const request = await Request.findById(requestId);
      if (!request) return;

      const message = { sender: socket.userId, senderName: user.name, text: text.trim(), time: new Date() };
      request.messages.push(message);
      await request.save();

      // Dono parties ko message bhejo
      const otherUserId = user.role === 'owner'
        ? request.technician?.toString()
        : request.owner.toString();

      const otherSocketId = onlineUsers.get(otherUserId);
      if (otherSocketId) {
        io.to(otherSocketId).emit('new-message', { requestId, message });
      }
      socket.emit('new-message', { requestId, message });
    } catch (err) {
      console.error('send-message error:', err);
    }
  });

  // Request complete
  socket.on('request-completed', async (requestId) => {
    try {
      const request = await Request.findById(requestId);
      if (!request) return;

      const otherUserId = socket.userRole === 'owner'
        ? request.technician?.toString()
        : request.owner.toString();

      const otherSocketId = onlineUsers.get(otherUserId);
      if (otherSocketId) {
        io.to(otherSocketId).emit('request-done', { requestId });
      }
    } catch (err) {
      console.error('request-completed error:', err);
    }
  });

  socket.on('disconnect', async () => {
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      // Technician offline hone par unavailable karo
      if (socket.userRole === 'technician') {
        await User.findByIdAndUpdate(socket.userId, { isAvailable: false });
      }
      console.log(`User ${socket.userId} offline`);
    }
  });
});

// MongoDB connect
async function startServer() {
  try {
    let mongoUri = process.env.MONGO_URI;

    if (!mongoUri) {
      if (process.env.NODE_ENV !== 'production') {
        const mongoServer = await MongoMemoryServer.create();
        mongoUri = mongoServer.getUri();
        console.log('Using in-memory MongoDB for development');
      } else {
        throw new Error('MONGO_URI is required in production');
      }
    }

    await mongoose.connect(mongoUri);
    console.log('MongoDB se connect ho gaya!');

    server.listen(process.env.PORT || 5000, () => {
      console.log(`Server port ${process.env.PORT || 5000} par chal raha hai`);
    });
  } catch (err) {
    console.error('MongoDB error:', err);
    process.exit(1);
  }
}

startServer();
