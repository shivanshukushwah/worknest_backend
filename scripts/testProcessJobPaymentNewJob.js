(async ()=>{
  try{ require('dotenv').config({ path: require('path').resolve(__dirname,'..','.env') }) }catch(e){}
  const mongoose = require('mongoose')
  const Job = require('../models/Job')
  const User = require('../models/User')
  const Wallet = require('../models/Wallet')
  const jwt = require('jsonwebtoken')
  const axios = require('axios')

  try{
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/test')
    const origJob = await Job.findById('69615b2fe17f13a8c78085e1').lean()
    const emp = await User.findById(origJob.employer).lean()
    const stu = await User.findById(origJob.assignedStudents[0]).lean()
    const secret = process.env.JWT_SECRET || 'testsecret'
    const tokenEmp = jwt.sign({ id: emp._id, email: emp.email, role: emp.role }, secret)

    const newJob = await Job.create({ title: 'TMP Test Job - payment', description: 'tmp', category: 'test', budget: 500, duration: '1', employer: emp._id, postedBy: emp._id, status: 'in_progress', assignedStudent: stu._id, assignedStudents: [stu._id], jobType: 'online' })
    console.log('Created job', newJob._id.toString())

    let w = await Wallet.findOne({ user: emp._id })
    if (!w) { w = new Wallet({ user: emp._id, balance: 1000, escrowBalance: 0 }); await w.save() } else { w.balance = Math.max(w.balance || 0, 1000); await w.save() }

    const base = process.env.BASE_URL || 'http://localhost:5000'
    console.log('Calling job-payment for job', newJob._id.toString())
    const res = await axios.post(`${base}/api/payments/job-payment/${newJob._id}`, {}, { headers: { Authorization: `Bearer ${tokenEmp}` } })
    console.log('Response:', JSON.stringify(res.data, null,2))

    await mongoose.disconnect()
  } catch (err) {
    console.error('Error:', err.response ? err.response.data : err.message)
    process.exit(1)
  }
})()
