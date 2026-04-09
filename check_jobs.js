const mongoose = require("mongoose");
const Job = require("./models/Job");
const User = require("./models/User");
require("dotenv").config();

async function check() {
  try {
    await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/job-marketplace");
    console.log("Connected to MongoDB");

    const jobs = await Job.find({});
    console.log(`Total jobs in DB: ${jobs.length}`);
    
    if (jobs.length > 0) {
      console.log("Sample Job (first one):");
      console.log(JSON.stringify(jobs[0], null, 2));
    }

    const students = await User.find({ role: "student" });
    console.log(`Total students in DB: ${students.length}`);
    if (students.length > 0) {
      console.log("Sample Student (first one):");
      console.log(JSON.stringify(students[0], null, 2));
    }

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

check();
