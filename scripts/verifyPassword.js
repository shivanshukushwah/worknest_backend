(async () => {
  try {
    try { require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') }) } catch (e) {}
    const mongoose = require('mongoose')
    const bcrypt = require('bcryptjs')
    const User = require('../models/User')

    const [,, identifier, password] = process.argv
    if (!identifier || !password) {
      console.error('Usage: node verifyPassword.js <emailOrId> <password>')
      process.exit(1)
    }

    const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/test'
    await mongoose.connect(uri)

    const { Types } = mongoose
    let user = null
    if (Types.ObjectId.isValid(identifier)) user = await User.findById(identifier)
    else user = await User.findOne({ email: identifier })

    if (!user) {
      console.error('User not found')
      process.exit(1)
    }

    console.log('Found user:', { id: user._id.toString(), email: user.email, isActive: user.isActive, isPhoneVerified: user.isPhoneVerified })
    console.log('Stored password hash:', user.password)

    const match = bcrypt.compareSync(password, user.password)
    console.log('Password match:', match)

    await mongoose.disconnect()
    process.exit(0)
  } catch (err) {
    console.error('Error in verifyPassword:', err)
    process.exit(1)
  }
})()
