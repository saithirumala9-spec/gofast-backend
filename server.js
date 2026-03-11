const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ── MIDDLEWARE ─────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json());

// ── DATABASE ───────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ── ROUTES ─────────────────────────────────────────────────
app.use('/api/auth',    require('./routes/auth'));
app.use('/api/rides',   require('./routes/rides'));
app.use('/api/payment', require('./routes/payment'));
app.use('/api/admin',   require('./routes/admin'));
app.use('/api/driver',  require('./routes/driver'));

// ── ONLINE DRIVERS MAP ─────────────────────────────────────
// driverId -> { socketId, lat, lng, rideType, isAvailable }
const onlineDrivers = new Map();

// ── SOCKET.IO ──────────────────────────────────────────────
io.on('connection', (socket) => {
  const { userId, role } = socket.handshake.query;
  console.log(`🔌 ${role} connected: ${userId}`);

  // ── DRIVER: GO ONLINE ────────────────────────────────────
  socket.on('driverOnline', async ({ driverId, lat, lng }) => {
    onlineDrivers.set(driverId, {
      socketId: socket.id,
      lat, lng,
      driverId,
      isAvailable: true,
    });
    console.log(`🟢 Driver online: ${driverId}. Total: ${onlineDrivers.size}`);
  });

  // ── DRIVER: GO OFFLINE ───────────────────────────────────
  socket.on('driverOffline', ({ driverId }) => {
    onlineDrivers.delete(driverId);
    console.log(`🔴 Driver offline: ${driverId}`);
  });

  // ── DRIVER: UPDATE LOCATION ──────────────────────────────
  socket.on('updateLocation', async ({ driverId, latitude, longitude }) => {
    if (onlineDrivers.has(driverId)) {
      const driver = onlineDrivers.get(driverId);
      driver.lat = latitude;
      driver.lng = longitude;
      onlineDrivers.set(driverId, driver);

      // Broadcast to customer if in ride
      if (driver.currentRideId) {
        const rideRoom = `ride_${driver.currentRideId}`;
        socket.to(rideRoom).emit('driverLocation', { latitude, longitude });
      }

      // Save to DB every 10 updates (reduce DB writes)
      driver.locationUpdateCount = (driver.locationUpdateCount || 0) + 1;
      if (driver.locationUpdateCount % 10 === 0) {
        await updateDriverLocationInDB(driverId, latitude, longitude);
      }
    }
  });

  // ── CUSTOMER: REQUEST RIDE ───────────────────────────────
  socket.on('requestRide', async (rideData) => {
    try {
      // Save ride to DB
      const Ride = require('./models/Ride');
      const ride = await Ride.create({
        customerId: rideData.customerId,
        pickup: rideData.pickup,
        drop: rideData.drop,
        rideType: rideData.rideType,
        fare: rideData.fare,
        distanceKm: rideData.distanceKm,
        status: 'searching',
        customerSocketId: socket.id,
      });

      // Join ride room
      socket.join(`ride_${ride._id}`);

      // Find nearest available driver
      const nearestDriver = findNearestDriver(
        rideData.pickup.lat,
        rideData.pickup.lng,
        rideData.rideType
      );

      if (nearestDriver) {
        // Send ride request to driver
        io.to(nearestDriver.socketId).emit('newRideRequest', {
          rideId: ride._id.toString(),
          customerId: rideData.customerId,
          pickup: rideData.pickup,
          drop: rideData.drop,
          rideType: rideData.rideType,
          fare: rideData.fare,
          distanceKm: rideData.distanceKm,
          distance: calculateDistance(
            nearestDriver.lat, nearestDriver.lng,
            rideData.pickup.lat, rideData.pickup.lng
          ).toFixed(1) + ' km away',
        });

        // Mark driver as busy
        nearestDriver.isAvailable = false;
        nearestDriver.pendingRideId = ride._id.toString();

        // Timeout - if driver doesn't respond in 30s, try next
        setTimeout(async () => {
          const updatedRide = await Ride.findById(ride._id);
          if (updatedRide && updatedRide.status === 'searching') {
            socket.emit('noDriverFound');
          }
        }, 30000);
      } else {
        socket.emit('noDriverFound');
      }
    } catch (err) {
      console.error('Request ride error:', err);
    }
  });

  // ── DRIVER: ACCEPT RIDE ──────────────────────────────────
  socket.on('acceptRide', async ({ rideId, driverId }) => {
    try {
      const Ride = require('./models/Ride');
      const Driver = require('./models/Driver');

      const ride = await Ride.findByIdAndUpdate(
        rideId,
        { status: 'driver_found', driverId },
        { new: true }
      );

      const driverData = await Driver.findOne({ userId: driverId });
      const driver = onlineDrivers.get(driverId);
      if (driver) {
        driver.currentRideId = rideId;
        driver.isAvailable = false;
        onlineDrivers.set(driverId, driver);
      }

      // Notify customer
      const rideRoom = `ride_${rideId}`;
      io.to(rideRoom).emit('rideAccepted', {
        driver: {
          name: driverData?.name || 'GoFast Driver',
          phone: driverData?.phone,
          rating: driverData?.rating || 4.8,
          totalRides: driverData?.totalRides || 0,
          vehicle: driverData?.vehicleModel,
          plate: driverData?.vehiclePlate,
          currentLat: driver?.lat,
          currentLng: driver?.lng,
        }
      });

      // Driver joins ride room
      socket.join(rideRoom);
    } catch (err) {
      console.error('Accept ride error:', err);
    }
  });

  // ── DRIVER: REJECT RIDE ──────────────────────────────────
  socket.on('rejectRide', ({ rideId, driverId }) => {
    const driver = onlineDrivers.get(driverId);
    if (driver) {
      driver.isAvailable = true;
      driver.pendingRideId = null;
      onlineDrivers.set(driverId, driver);
    }
    // TODO: Find next nearest driver
  });

  // ── DRIVER: START RIDE ───────────────────────────────────
  socket.on('startRide', async ({ rideId }) => {
    const Ride = require('./models/Ride');
    await Ride.findByIdAndUpdate(rideId, {
      status: 'ongoing',
      startedAt: new Date(),
    });
    io.to(`ride_${rideId}`).emit('rideStarted', { rideId });
  });

  // ── DRIVER: COMPLETE RIDE ────────────────────────────────
  socket.on('completeRide', async ({ rideId }) => {
    try {
      const Ride = require('./models/Ride');
      const ride = await Ride.findByIdAndUpdate(rideId, {
        status: 'completed',
        completedAt: new Date(),
      }, { new: true });

      // Calculate commission (20% to platform)
      const platformCommission = ride.fare * 0.20;
      const driverEarning = ride.fare * 0.80;

      // Update driver earnings
      const Driver = require('./models/Driver');
      await Driver.findOneAndUpdate(
        { userId: ride.driverId },
        {
          $inc: { totalEarnings: driverEarning, totalRides: 1 },
        }
      );

      // Free up driver
      const driver = onlineDrivers.get(ride.driverId);
      if (driver) {
        driver.isAvailable = true;
        driver.currentRideId = null;
        onlineDrivers.set(ride.driverId, driver);
      }

      io.to(`ride_${rideId}`).emit('rideCompleted', {
        rideId,
        fare: ride.fare,
        driverEarning,
        platformCommission,
      });
    } catch (err) {
      console.error('Complete ride error:', err);
    }
  });

  // ── CUSTOMER: CANCEL RIDE ────────────────────────────────
  socket.on('cancelRide', async ({ rideId }) => {
    const Ride = require('./models/Ride');
    const ride = await Ride.findByIdAndUpdate(rideId, {
      status: 'cancelled',
      cancelledAt: new Date(),
    }, { new: true });

    if (ride?.driverId) {
      const driver = onlineDrivers.get(ride.driverId);
      if (driver) {
        driver.isAvailable = true;
        driver.currentRideId = null;
      }
      io.to(`ride_${rideId}`).emit('rideCancelled');
    }
  });

  // ── DISCONNECT ───────────────────────────────────────────
  socket.on('disconnect', () => {
    if (role === 'driver') {
      onlineDrivers.delete(userId);
    }
    console.log(`🔌 ${role} disconnected: ${userId}`);
  });
});

// ── HELPER: FIND NEAREST DRIVER ───────────────────────────
function findNearestDriver(lat, lng, rideType) {
  let nearest = null;
  let minDistance = Infinity;

  for (const [driverId, driver] of onlineDrivers) {
    if (!driver.isAvailable) continue;

    const dist = calculateDistance(lat, lng, driver.lat, driver.lng);
    if (dist < minDistance && dist < 10) { // within 10km
      minDistance = dist;
      nearest = driver;
    }
  }

  return nearest;
}

// ── HELPER: HAVERSINE DISTANCE (km) ──────────────────────
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function updateDriverLocationInDB(driverId, lat, lng) {
  try {
    const Driver = require('./models/Driver');
    await Driver.findOneAndUpdate(
      { userId: driverId },
      { 'currentLocation.lat': lat, 'currentLocation.lng': lng, lastSeen: new Date() }
    );
  } catch (e) {}
}

// ── START SERVER ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 GoFast Server running on port ${PORT}`);
});
