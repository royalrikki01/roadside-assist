const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

const generateToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password, role, skills, vehicleTypes } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: 'Email pehle se registered hai' });

    const user = await User.create({
      name, email, phone, password, role,
      skills: skills || [],
      vehicleTypes: vehicleTypes || []
    });

    const token = generateToken(user._id);
    res.status(201).json({
      token,
      user: {
        id: user._id, name: user.name, email: user.email,
        phone: user.phone, role: user.role,
        skills: user.skills, vehicleTypes: user.vehicleTypes,
        isAvailable: user.isAvailable, rating: user.rating
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error: ' + err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Email ya password galat hai' });

    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(400).json({ message: 'Email ya password galat hai' });

    const token = generateToken(user._id);
    res.json({
      token,
      user: {
        id: user._id, name: user.name, email: user.email,
        phone: user.phone, role: user.role,
        skills: user.skills, vehicleTypes: user.vehicleTypes,
        isAvailable: user.isAvailable, rating: user.rating
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error: ' + err.message });
  }
});

// Get current user
router.get('/me', authMiddleware, async (req, res) => {
  res.json({ user: req.user });
});

// Update availability (technician only)
router.patch('/availability', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'technician') return res.status(403).json({ message: 'Sirf technician ke liye' });
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { isAvailable: req.body.isAvailable },
      { new: true }
    ).select('-password');
    res.json({ user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update vehicle info (owner only)
router.patch('/vehicle-info', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'owner') return res.status(403).json({ message: 'Sirf owner ke liye' });
    
    const { description, photo } = req.body;
    
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { 
        $set: {
          'vehicleInfo.description': description || '',
          'vehicleInfo.photo': photo || ''
        }
      },
      { new: true }
    ).select('-password');
    
    res.json({ 
      message: 'Vehicle info save ho gaya!',
      user 
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
