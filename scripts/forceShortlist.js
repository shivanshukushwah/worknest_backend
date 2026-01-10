(async ()=>{
  try {
    // load .env if present so script uses same DB as server
    try { require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') }) } catch (e) { }
    const mongoose = require('mongoose')
    const Job = require('../models/Job')
    const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/test'
    await mongoose.connect(uri)

    const jobId = process.argv[2] || process.env.JOB_ID
    if (!jobId) {
      console.error('Usage: node scripts/forceShortlist.js <jobId>')
      process.exit(1)
    }

    let job = await Job.findById(jobId).lean()
    console.log('BEFORE:', JSON.stringify({ jobType: job ? job.jobType : null, shortlistWindowEndsAt: job ? job.shortlistWindowEndsAt : null, shortlistComputed: job ? job.shortlistComputed : null, applications: job ? job.applications.map(a => ({ id: a._id, createdAt: a.createdAt, evaluationScore: a.evaluationScore, shortlisted: !!a.shortlisted, profileUrl: a.profileUrl })) : [] }, null, 2))

    if (!job) {
      console.log('Job not found')
      await mongoose.disconnect()
      process.exit(0)
    }

    const now = new Date()
    if (!job.shortlistWindowEndsAt || new Date(job.shortlistWindowEndsAt) > now || job.shortlistComputed) {
      await Job.updateOne({ _id: jobId }, { $set: { shortlistWindowEndsAt: new Date(Date.now() - 1000), shortlistComputed: false } })
      console.log('Adjust: set shortlistWindowEndsAt to past and reset shortlistComputed')
    }

    const { processDueShortlists } = require('../services/shortlistScheduler')
    await processDueShortlists()

    job = await Job.findById(jobId).lean()
    const shortlisted = (job.applications || []).filter(a => a.shortlisted).map(a => ({ applicationId: a._id, student: a.student, evaluationScore: a.evaluationScore, createdAt: a.createdAt }))

    console.log('AFTER SHORTLIST:', JSON.stringify({ shortlistComputed: job.shortlistComputed, shortlistedCount: shortlisted.length, shortlisted }, null, 2))

    await mongoose.disconnect()
  } catch (err) {
    console.error('Error in forceShortlist:', err)
    process.exit(1)
  }
})()
