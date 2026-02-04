const mongoose = require("mongoose")
const { JOB_STATUS } = require("../utils/constants")

const applicationSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  coverLetter: { type: String },
  proposedBudget: { type: Number },
  profileUrl: { type: String }, // required for online jobs
  evaluationScore: { type: Number, default: 0 }, // auto-evaluated for online jobs
  shortlisted: { type: Boolean, default: false },
  status: { type: String, default: "applied" },
  createdAt: { type: Date, default: Date.now },
  // Inspection metadata
  inspection: {
    status: { type: String, enum: ['queued','inspecting','done','failed'], default: 'queued' },
    result: { type: mongoose.Schema.Types.Mixed },
    error: { type: String },
    inspectedAt: { type: Date },
  },
})

const jobSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  category: { type: String, required: true },
  budget: { type: Number, required: true },
  duration: { type: String, required: true },
  employer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  postedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  assignedStudent: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  assignedStudents: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  positionsRequired: { type: Number, default: 1 },
  acceptedCount: { type: Number, default: 0 },
  // jobType: 'offline' or 'online'
  jobType: { type: String, enum: ['offline', 'online'], default: 'offline' },
  // Location (for offline jobs)
  location: {
    city: String,
    state: String,
    country: String,
    coordinates: {
      latitude: Number,
      longitude: Number,
    },
  },
  // For online jobs, multiplier controls shortlist size
  shortlistMultiplier: { type: Number, default: 3 },
  // Shortlisting window: end time and window length in hours
  shortlistWindowEndsAt: { type: Date },
  // Enforce a minimum of 1 hour; employer can set any higher value
  shortlistWindowHours: { type: Number, default: 3, min: 1 },
  shortlistComputed: { type: Boolean, default: false },
  shortlistedAt: { type: Date },
  status: { type: String, default: JOB_STATUS.OPEN },
  closedAt: { type: Date },
  shortlistedAt: { type: Date },
  escrowAmount: { type: Number, default: 0 },
  paymentReleased: { type: Boolean, default: false },
  studentAccepted: { type: Boolean, default: false },
  studentApproved: { type: Boolean, default: false },
  employerApproved: { type: Boolean, default: false },
  // If true, student must upload attachments when submitting work
  submissionRequiresFiles: { type: Boolean, default: false },
  submission: {
    description: { type: String },
    attachments: [{ type: String }],
    submittedAt: { type: Date },
  },
  applications: [applicationSchema], // <- added
  createdAt: { type: Date, default: Date.now },
})

module.exports = mongoose.model("Job", jobSchema)
