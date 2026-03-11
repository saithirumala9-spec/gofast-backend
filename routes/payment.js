const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const Ride = require('../models/Ride');

// ── RAZORPAY INSTANCE ─────────────────────────────────────
// Get keys from https://dashboard.razorpay.com
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ─── CREATE ORDER ─────────────────────────────────────────
// POST /api/payment/create-order
router.post('/create-order', async (req, res) => {
  try {
    const { amount, currency = 'INR', rideId } = req.body;

    const options = {
      amount: amount,         // Amount in paise (multiply by 100)
      currency: currency,
      receipt: `ride_${rideId}_${Date.now()}`,
      notes: {
        rideId: rideId,
        app: 'GoFast',
      },
    };

    const order = await razorpay.orders.create(options);

    // Save order ID to ride
    await Ride.findByIdAndUpdate(rideId, {
      razorpayOrderId: order.id,
      paymentStatus: 'pending',
    });

    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
    });
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── VERIFY PAYMENT ───────────────────────────────────────
// POST /api/payment/verify
router.post('/verify', async (req, res) => {
  try {
    const { orderId, paymentId, signature, rideId } = req.body;

    // Verify signature
    const body = orderId + '|' + paymentId;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    const isValid = expectedSignature === signature;

    if (isValid) {
      // Update ride payment status
      const ride = await Ride.findByIdAndUpdate(rideId, {
        razorpayPaymentId: paymentId,
        paymentStatus: 'paid',
        paymentMethod: 'upi',
        platformCommission: 0,
        driverEarning: 0,
      }, { new: true });

      // Calculate split
      const commission = ride.fare * ride.commissionRate;
      const driverEarning = ride.fare - commission;

      await Ride.findByIdAndUpdate(rideId, {
        platformCommission: commission,
        driverEarning: driverEarning,
      });

      res.json({ success: true, verified: true, rideId });
    } else {
      await Ride.findByIdAndUpdate(rideId, { paymentStatus: 'failed' });
      res.json({ success: false, verified: false });
    }
  } catch (err) {
    console.error('Verify payment error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET PAYMENT DETAILS ──────────────────────────────────
// GET /api/payment/:paymentId
router.get('/:paymentId', async (req, res) => {
  try {
    const payment = await razorpay.payments.fetch(req.params.paymentId);
    res.json({ success: true, payment });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── REFUND PAYMENT ───────────────────────────────────────
// POST /api/payment/refund
router.post('/refund', async (req, res) => {
  try {
    const { paymentId, amount, rideId } = req.body;

    const refund = await razorpay.payments.refund(paymentId, {
      amount: amount * 100,
      notes: { rideId, reason: 'Customer requested refund' },
    });

    res.json({ success: true, refund });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
