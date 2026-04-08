const mongoose = require('mongoose');
const Job = require('./models/Job');
const User = require('./models/User');
require('dotenv').config();

async function check() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to DB');

    const jobsCount = await Job.countDocuments();
    console.log('Total jobs:', jobsCount);

    const openJobs = await Job.find({ status: 'open' });
    console.log('Open jobs:', openJobs.length);
    if (openJobs.length > 0) {
      console.log('First open job:', JSON.stringify(openJobs[0], null, 2));
    }

    const students = await User.find({ role: 'student' });
    console.log('Total students:', students.length);
    if (students.length > 0) {
      console.log('First student location:', JSON.stringify(students[0].location, null, 2));
    }

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

check();
