const express = require('express');
const router = express.Router();
const Request = require('../models/Request');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

// New help request banana (owner)
router.post('/', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'owner') return res.status(403).json({ message: 'Sirf vehicle owner request kar sakta hai' });

    const { vehicleType, problemType, description, lat, lng, address } = req.body;

    // Check karo koi active request toh nahi hai pehle se
    const existing = await Request.findOne({
      owner: req.user._id,
      status: { $in: ['pending', 'accepted', 'in-progress'] }
    });
    if (existing) return res.status(400).json({ message: 'Aapki ek request pehle se active hai', request: existing });

    const request = await Request.create({
      owner: req.user._id,
      vehicleType,
      problemType,
      description,
      ownerLocation: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
      address
    });

    await request.populate('owner', 'name phone email');
    res.status(201).json({ request });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Owner ki active request
router.get('/my-active', authMiddleware, async (req, res) => {
  try {
    const query = req.user.role === 'owner'
      ? { owner: req.user._id, status: { $in: ['pending', 'accepted', 'in-progress'] } }
      : { technician: req.user._id, status: { $in: ['accepted', 'in-progress'] } };

    const request = await Request.findOne(query)
      .populate('owner', 'name phone email')
      .populate('technician', 'name phone skills rating location');

    res.json({ request });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Owner ki history
router.get('/my-history', authMiddleware, async (req, res) => {
  try {
    const query = req.user.role === 'owner'
      ? { owner: req.user._id }
      : { technician: req.user._id };

    const requests = await Request.find({ ...query, status: { $in: ['completed', 'cancelled'] } })
      .populate('owner', 'name phone')
      .populate('technician', 'name phone skills rating')
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({ requests });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Technician ke liye nearby pending requests
router.get('/nearby-requests', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'technician') return res.status(403).json({ message: 'Sirf technician ke liye' });

    const { lat, lng, radius = 15 } = req.query;
    if (!lat || !lng) return res.status(400).json({ message: 'Location chahiye' });

    const requests = await Request.find({
      status: 'pending',
      ownerLocation: {
        $near: {
          $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
          $maxDistance: radius * 1000
        }
      }
    }).populate('owner', 'name phone').limit(10);

    res.json({ requests });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Request accept karo (technician)
router.patch('/:id/accept', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'technician') return res.status(403).json({ message: 'Sirf technician accept kar sakta hai' });

    const request = await Request.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request nahi mili' });
    if (request.status !== 'pending') return res.status(400).json({ message: 'Request already ' + request.status + ' hai' });

    request.technician = req.user._id;
    request.status = 'accepted';
    request.acceptedAt = new Date();
    await request.save();

    await request.populate('owner', 'name phone email');
    await request.populate('technician', 'name phone skills rating location');

    res.json({ request });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Request complete karo
router.patch('/:id/complete', authMiddleware, async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request nahi mili' });

    const canComplete = req.user.role === 'technician'
      ? request.technician?.toString() === req.user._id.toString()
      : request.owner.toString() === req.user._id.toString();

    if (!canComplete) return res.status(403).json({ message: 'Permission nahi hai' });

    request.status = 'completed';
    request.completedAt = new Date();
    if (req.body.rating) {
      if (req.user.role === 'owner') request.technicianRating = req.body.rating;
      else request.ownerRating = req.body.rating;

      // Update technician rating
      if (req.user.role === 'owner' && request.technician) {
        const tech = await User.findById(request.technician);
        const newTotal = tech.totalRatings + 1;
        tech.rating = ((tech.rating * tech.totalRatings) + req.body.rating) / newTotal;
        tech.totalRatings = newTotal;
        await tech.save();
      }
    }
    await request.save();
    res.json({ request });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Request cancel karo
router.patch('/:id/cancel', authMiddleware, async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request nahi mili' });
    if (request.owner.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Sirf owner cancel kar sakta hai' });

    request.status = 'cancelled';
    await request.save();
    res.json({ request });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
