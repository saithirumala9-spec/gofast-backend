const mongoose = require('mongoose');

const driverSchema = new mongoose.Schema({
  userId:   { type: String, required: true, unique: true },
  phone:    { type: String, required: true },
  name:     { type: String, required: true },
  email:    { type: String },
  photo:    { type: String },

  // Vehicle info
  vehicleType:  { type: String, enum: ['bike','auto','car'], required: true },
  vehicleModel: { type: String, required: true },
  vehiclePlate: { type: String, required: true, unique: true },
  vehicleColor: { type: String },
  vehicleYear:  { type: Number },

  // Documents
  aadharNumber:    { type: String },
  licenseNumber:   { type: String },
  rcNumber:        { type: String },
  aadharVerified:  { type: Boolean, default: false },
  licenseVerified: { type: Boolean, default: false },
  rcVerified:      { type: Boolean, default: false },

  // Status
  isApproved:  { type: Boolean, default: false },
  isOnline:    { type: Boolean, default: false },
  isAvailable: { type: Boolean, default: true },
  isBanned:    { type: Boolean, default: false },

  // Location
  currentLocation: {
    lat: { type: Number },
    lng: { type: Number },
  },
  lastSeen: { type: Date },

  // Stats
  rating:        { type: Number, default: 5.0 },
  totalRides:    { type: Number, default: 0 },
  totalEarnings: { type: Number, default: 0 },
  totalRatings:  { type: Number, default: 0 },

  // Bank details for payout
  bankAccountNumber: { type: String },
  bankIfscCode:      { type: String },
  upiId:             { type: String },

}, { timestamps: true });

driverSchema.index({ 'currentLocation.lat': 1, 'currentLocation.lng': 1 });
driverSchema.index({ isOnline: 1, isAvailable: 1 });

module.exports = mongoose.model('Driver', driverSchema);
