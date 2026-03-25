const mongoose = require('mongoose')
const jwt = require('jsonwebtoken')
const User = require('./models/User')
const Job = require('./models/Job')

// Simple manual test for job creation and retrieval
async function testJobFlow() {
  try {
    // Connect to MongoDB (use your actual connection string)
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/worknest_test')

    console.log('Connected to MongoDB')

    // Create test employer
    const employer = await User.create({
      name: 'Test Employer',
      email: 'testemployer@example.com',
      password: 'hashedpass',
      role: 'employer',
      phone: '+911234567890',
      businessName: 'Test Business',
      businessType: 'IT',
      businessAddress: { city: 'Delhi', state: 'DL' },
      isEmailVerified: true,
      isActive: true,
      isProfileComplete: true
    })

    console.log('Created employer:', employer._id)

    // Create JWT token (simulate auth)
    const token = jwt.sign(
      { id: employer._id, email: employer.email, role: employer.role },
      process.env.JWT_SECRET || 'testsecret'
    )

    console.log('Generated token')

    // Simulate job creation
    const jobData = {
      title: 'Test Job',
      description: 'Test job description',
      category: 'Development',
      budget: 1000,
      duration: '5 days',
      jobType: 'offline',
      location: { city: 'Delhi', state: 'DL', country: 'India' }
    }

    const job = await Job.create({
      ...jobData,
      employer: employer._id,
      postedBy: employer._id,
      positionsRequired: 1,
      shortlistMultiplier: 3,
      shortlistWindowHours: 3,
      status: 'open'
    })

    console.log('Created job:', job._id, job.title)

    // Test getMyJobs (simulate the controller logic)
    const employerId = employer._id // simulate getUserId(req.user)
    const jobs = await Job.find({ employer: employerId }).sort({ createdAt: -1 })

    console.log('Found jobs for employer:', jobs.length)
    console.log('Job details:', jobs.map(j => ({ id: j._id, title: j.title, employer: j.employer })))

    // Test profile with job stats
    const jobQuery = { employer: employer._id }
    const totalJobsPosted = await Job.countDocuments(jobQuery)
    const activeJobs = await Job.countDocuments({ ...jobQuery, status: { $in: ['open', 'in_progress'] } })
    const completedJobs = await Job.countDocuments({ ...jobQuery, status: { $in: ['completed', 'paid'] } })

    console.log('Job stats:', { totalJobsPosted, activeJobs, completedJobs })

    // Test includeJobs query
    const jobsList = await Job.find(jobQuery).sort({ createdAt: -1 }).lean()
    console.log('Jobs list length:', jobsList.length)

    console.log('✅ All tests passed!')

  } catch (error) {
    console.error('❌ Test failed:', error)
  } finally {
    await mongoose.disconnect()
    console.log('Disconnected from MongoDB')
  }
}

testJobFlow()