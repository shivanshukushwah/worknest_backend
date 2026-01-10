(async () => {
  try {
    // Load environment (optional .env in repo root)
    try { require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') }) } catch (e) { }

    const mongoose = require('mongoose')
    const bcrypt = require('bcryptjs')
    const User = require('../models/User')

    const [,, identifier, newPassword, flag] = process.argv

    if (!identifier || !newPassword) {
      console.error('Usage: node resetAdminPassword.js <emailOrId> <newPassword> [--create]')
      process.exit(1)
    }

    const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/test'
    await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true })

    const { Types } = mongoose

    let user = null
    if (Types.ObjectId.isValid(identifier)) {
      user = await User.findById(identifier)
    } else {
      user = await User.findOne({ email: identifier })
    }

    if (!user) {
      if (flag === '--create') {
        const hashed = bcrypt.hashSync(newPassword, 10)
        const email = identifier && identifier.includes('@') ? identifier : 'admin@example.com'
        const adminUser = new User({
          name: 'Platform Admin',
          email,
          password: hashed,
          role: 'admin',
          isActive: true,
        })
        await adminUser.save()
        console.log('Created new admin user with id:', adminUser._id.toString())
        await mongoose.disconnect()
        process.exit(0)
      }

      console.error('User not found. Pass --create to create a new admin.')
      await mongoose.disconnect()
      process.exit(1)
    }

    // Reset password (bcrypt hashed)
    user.password = bcrypt.hashSync(newPassword, 10)
    await user.save()

    console.log('Password reset successful for user:', user.email || user._id.toString())
    console.log('Tip: delete this script after use to avoid leaving tools in the repo.')

    await mongoose.disconnect()
    process.exit(0)
  } catch (err) {
    console.error('Error resetting admin password:', err)
    process.exit(1)
  }
})()
