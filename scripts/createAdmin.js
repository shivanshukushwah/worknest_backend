// scripts/createAdmin.js
require('dotenv').config()
const mongoose = require('mongoose')
const bcrypt = require('bcrypt')
const User = require('../models/User') // adjust path if running from project root

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'StrongAdminPassword!123'
const ADMIN_NAME = process.env.ADMIN_NAME || 'Platform Admin'

;(async () => {
  await mongoose.connect(process.env.MONGO_URI)

  let user = await User.findOne({ email: ADMIN_EMAIL })
  if (user) {
    if (user.role !== 'admin') {
      user.role = 'admin'
      await user.save()
      console.log('Existing user updated to admin. ID:', user._id)
    } else {
      console.log('Admin already exists. ID:', user._id)
    }
    process.exit(0)
  }

  const hashed = await bcrypt.hash(ADMIN_PASSWORD, 10)
  user = await User.create({
    name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    password: hashed,
    role: 'admin'
  })
  console.log('Admin created. ID:', user._id)
  process.exit(0)
})().catch(err => { console.error(err); process.exit(1) })