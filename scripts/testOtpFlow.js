#!/usr/bin/env node
require('dotenv').config();
const axios = require('axios');
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/job-marketplace';
const SERVER = process.env.SERVER_URL || 'http://localhost:5000';

async function main() {
  const ts = Date.now() % 10000;
  const phone = `+91990${('0000' + (ts % 10000)).slice(-4)}`;
  const email = `test+${ts}@example.com`;
  const payload = { name: 'Test User', email, password: 'Pass1234', confirmPassword: 'Pass1234', role: 'student', phone, location: { city: 'TestCity', state: 'TestState', country: 'TestCountry' } };

  try {
    console.log('Registering', phone, email);
    const r = await axios.post(`${SERVER}/api/auth/register`, payload, { timeout: 10000 });
    console.log('Register response:', r.data);
  } catch (e) {
    console.error('Register error:', e.response ? e.response.data : e.message);
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  } catch (e) {
    console.error('Mongo connect error:', e.message || e);
    process.exit(1);
  }

  // Use a flexible schema to read test-only fields
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }), 'users');
  const user = await User.findOne({ phone }).lean();
  if (!user) {
    console.error('User not found in DB');
    process.exit(1);
  }

  console.log('User from DB:', { phone: user.phone, phoneOtp: user.phoneOtp, isPhoneVerified: user.isPhoneVerified, phoneOtpExpires: user.phoneOtpExpires });

  const otp = user.phoneOtp;
  if (!otp) {
    console.error('OTP not found in DB (ensure NODE_ENV=test)');
    process.exit(1);
  }

  try {
    const v = await axios.post(`${SERVER}/api/auth/verify-otp`, { phone, otp }, { timeout: 10000 });
    console.log('Verify response:', v.data);
  } catch (e) {
    console.error('Verify error:', e.response ? e.response.data : e.message);
    process.exit(1);
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
