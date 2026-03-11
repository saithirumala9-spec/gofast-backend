const mongoose = require('mongoose');

const rideSchema = new mongoose.Schema({
  customerId:       { type: String, required: true },
  driverId:         { type: String, default: null },
  customerSocketId: { type: String },

  pickup: {
    lat:     { type: Number, required: true },
    lng:     { type: Number, required: true },
    address: { type: String, required: true },
  },
  drop: {
    lat:     { type: Number, required: true },
    lng:     { type: Number, required: true },
    address: { type: String, required: true },
  },

  rideType:   { type: String, enum: ['bike','auto','car','delivery'], default: 'bike' },
  fare:       { type: Number, required: true },
  distanceKm: { type: Number, required: true },

  status: {
    type: String,
    enum: ['searching','driver_found','ongoing','completed','cancelled'],
    default: 'searching',
  },

  paymentStatus: { type: String, enum: ['pending','paid','failed'], default: 'pending' },
  paymentMethod: { type: String, enum: ['cash','upi','card','wallet'], default: 'cash' },
  razorpayOrderId:   { type: String },
  razorpayPaymentId: { type: String },

  // Commission breakdown
  platformCommission: { type: Number, default: 0 },
  driverEarning:      { type: Number, default: 0 },
  commissionRate:     { type: Number, default: 0.20 },

  customerRating: { type: Number, min: 1, max: 5 },
  driverRating:   { type: Number, min: 1, max: 5 },
  customerReview: { type: String },

  cancelReason:  { type: String },
  cancelledBy:   { type: String, enum: ['customer','driver','system'] },
  cancellationFee: { type: Number, default: 0 },

  startedAt:   { type: Date },
  completedAt: { type: Date },
  cancelledAt: { type: Date },
}, { timestamps: true });

// Index for fast location queries
rideSchema.index({ customerId: 1, createdAt: -1 });
rideSchema.index({ driverId: 1, createdAt: -1 });
rideSchema.index({ status: 1 });

module.exports = mongoose.model('Ride', rideSchema);
