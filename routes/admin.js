const express = require('express');
const router = express.Router();
const Ride = require('../models/Ride');
const Driver = require('../models/Driver');
const User = require('../models/User');

// ── ADMIN AUTH MIDDLEWARE ──────────────────────────────────
const adminAuth = (req, res, next) => {
  const token = req.headers['x-admin-token'];
  if (token !== process.env.ADMIN_SECRET_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// ─── DASHBOARD STATS ─────────────────────────────────────
// GET /api/admin/dashboard
router.get('/dashboard', adminAuth, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      todayRides,
      todayRevenue,
      totalRides,
      totalDrivers,
      activeDrivers,
      pendingDrivers,
      totalCustomers,
      activeCustomers,
    ] = await Promise.all([
      Ride.countDocuments({ createdAt: { $gte: today }, status: 'completed' }),
      Ride.aggregate([
        { $match: { createdAt: { $gte: today }, status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$fare' }, commission: { $sum: '$platformCommission' } } }
      ]),
      Ride.countDocuments({ status: 'completed' }),
      Driver.countDocuments(),
      Driver.countDocuments({ isOnline: true }),
      Driver.countDocuments({ isApproved: false, isBanned: false }),
      User.countDocuments({ role: 'customer' }),
      User.countDocuments({ role: 'customer', lastActive: { $gte: today } }),
    ]);

    // Weekly earnings chart
    const weeklyData = await Ride.aggregate([
      {
        $match: {
          status: 'completed',
          createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        }
      },
      {
        $group: {
          _id: { $dayOfWeek: '$createdAt' },
          rides: { $sum: 1 },
          revenue: { $sum: '$fare' },
          commission: { $sum: '$platformCommission' },
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      success: true,
      stats: {
        todayRides,
        todayRevenue: todayRevenue[0]?.total || 0,
        todayCommission: todayRevenue[0]?.commission || 0,
        totalRides,
        totalDrivers,
        activeDrivers,
        pendingDrivers,
        totalCustomers,
        activeCustomers,
        weeklyData,
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── APPROVE DRIVER ───────────────────────────────────────
// POST /api/admin/driver/approve/:driverId
router.post('/driver/approve/:driverId', adminAuth, async (req, res) => {
  try {
    await Driver.findOneAndUpdate(
      { userId: req.params.driverId },
      { isApproved: true }
    );
    // TODO: Send SMS/notification to driver
    res.json({ success: true, message: 'Driver approved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── BAN DRIVER ───────────────────────────────────────────
// POST /api/admin/driver/ban/:driverId
router.post('/driver/ban/:driverId', adminAuth, async (req, res) => {
  try {
    await Driver.findOneAndUpdate(
      { userId: req.params.driverId },
      { isBanned: true, isOnline: false }
    );
    res.json({ success: true, message: 'Driver banned' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET ALL RIDES ────────────────────────────────────────
// GET /api/admin/rides?status=completed&page=1&limit=20
router.get('/rides', adminAuth, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = status ? { status } : {};

    const rides = await Ride.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Ride.countDocuments(filter);

    res.json({ success: true, rides, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── UPDATE COMMISSION RATE ───────────────────────────────
// POST /api/admin/commission
router.post('/commission', adminAuth, async (req, res) => {
  try {
    const { rideType, rate } = req.body;
    // Store in DB or config
    res.json({ success: true, message: `Commission for ${rideType} set to ${rate}%` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET ALL DRIVERS ──────────────────────────────────────
router.get('/drivers', adminAuth, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    let filter = {};
    if (status === 'pending') filter = { isApproved: false, isBanned: false };
    if (status === 'active') filter = { isApproved: true, isBanned: false };
    if (status === 'banned') filter = { isBanned: true };

    const drivers = await Driver.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({ success: true, drivers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
