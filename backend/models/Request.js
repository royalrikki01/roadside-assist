const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  senderName: String,
  text: String,
  time: { type: Date, default: Date.now }
});

const requestSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  technician: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  vehicleType: { type: String, required: true },
  problemType: { type: String, required: true },
  description: { type: String, default: '' },

  ownerLocation: {
    type: { type: String, default: 'Point' },
    coordinates: { type: [Number], required: true }  // [lng, lat]
  },
  address: { type: String, default: '' },

  status: {
    type: String,
    enum: ['pending', 'accepted', 'in-progress', 'completed', 'cancelled'],
    default: 'pending'
  },

  messages: [messageSchema],

  ownerRating: { type: Number, default: 0 },
  technicianRating: { type: Number, default: 0 },

  createdAt: { type: Date, default: Date.now },
  acceptedAt: Date,
  completedAt: Date
});

requestSchema.index({ ownerLocation: '2dsphere' });

module.exports = mongoose.model('Request', requestSchema);
