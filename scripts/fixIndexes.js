// scripts/fixIndexes.js
require('dotenv').config()
const mongoose = require('mongoose')

;(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI)
    console.log('✅ Connected to MongoDB')

    const User = require('../models/User')
    
    // Disable auto index creation temporarily
    User.collection.autoIndex = false

    console.log('\n📋 Current indexes:')
    const currentIndexes = await User.collection.getIndexes()
    Object.entries(currentIndexes).forEach(([name, spec]) => {
      console.log(`  - ${name}:`, JSON.stringify(spec))
    })

    // Drop old unique email index if it exists
    if (currentIndexes.email_1) {
      await User.collection.dropIndex('email_1')
      console.log('\n✅ Dropped old email_1 unique index')
    }

    // Drop old unique phone index if it exists
    if (currentIndexes.phone_1) {
      await User.collection.dropIndex('phone_1')
      console.log('✅ Dropped old phone_1 unique index')
    }

    // Create new compound indexes
    await User.collection.createIndex({ email: 1, role: 1 }, { unique: true })
    console.log('✅ Created email_1_role_1 compound unique index')

    await User.collection.createIndex({ phone: 1, role: 1 }, { unique: true, sparse: true })
    console.log('✅ Created phone_1_role_1 compound unique index')

    console.log('\n📋 New indexes:')
    const newIndexes = await User.collection.getIndexes()
    Object.entries(newIndexes).forEach(([name, spec]) => {
      console.log(`  - ${name}:`, JSON.stringify(spec))
    })

    console.log('\n🎉 Index cleanup complete!')
    process.exit(0)
  } catch (err) {
    console.error('❌ Error:', err.message)
    process.exit(1)
  }
})()
