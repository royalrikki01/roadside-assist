const express = require('express');
const router = express.Router();
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

// Nearby technicians dhundo (radius in km)
router.get('/nearby', authMiddleware, async (req, res) => {
  try {
    const { lat, lng, radius = 10 } = req.query;
    if (!lat || !lng) return res.status(400).json({ message: 'Location chahiye' });

    const technicians = await User.find({
      role: 'technician',
      isAvailable: true,
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
          $maxDistance: radius * 1000  // meters mein
        }
      }
    }).select('-password').limit(20);

    res.json({ technicians });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Technician profile
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const technician = await User.findById(req.params.id).select('-password');
    if (!technician || technician.role !== 'technician')
      return res.status(404).json({ message: 'Technician nahi mila' });
    res.json({ technician });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
