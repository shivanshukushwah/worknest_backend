const mongoose = require('mongoose')
require('dotenv').config()
const User = require('../models/User')

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI)
  const res = await User.updateMany({ isActive: { $exists: false } }, { $set: { isActive: true } })
  console.log('Updated users:', res.modifiedCount || res.nModified || res.modified)
  await mongoose.disconnect()
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})