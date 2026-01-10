const mongoose = require('mongoose')

const scoreLogSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  event: { type: String, required: true },
  delta: { type: Number, required: true },
  reason: { type: String },
  meta: { type: Object },
  createdAt: { type: Date, default: Date.now },
})

module.exports = mongoose.model('ScoreLog', scoreLogSchema)
