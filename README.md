# WorkNest Backend 🚀

Production-ready backend for a **student–employer job marketplace** that supports
offline & online jobs, secure wallet payments, escrow, notifications, reviews,
and intelligent job allocation.

---

## 🎯 Project Goal

WorkNest is built to solve real-world hiring problems:

- Employers get **too many applications** → system auto-filters
- Students fake ratings/scores → **system-driven scoring only**
- Payments are risky → **escrow-based wallet system**
- Offline jobs need speed → **first-come-first-serve logic**

This backend is designed for **real deployment**, not just demos or hackathons.

---

## 🔥 Core Features

### 👤 Authentication
- Student & Employer roles
- Phone verification via OTP
- JWT-based authentication
- Signup now stores a **temporary user record** that is only kept until
  successful OTP verification. Expired/unverified records are automatically
  purged (TTL index) and cleaned up during new registration attempts to avoid
  ghost accounts and confusing "already registered" errors.
- Secure login/logout lifecycle

### 💼 Jobs & Applications
- Offline jobs (FCFS + auto-close)
- Online jobs (profile-based auto shortlisting)
- Employer-defined shortlisting time window
- Assignment → submission → approval flow

### 💰 Wallet & Payments
- Wallet system with ledger-based transactions
- Razorpay wallet deposits
- Escrow-based job payments
- Atomic release & refund logic (MongoDB transactions)
- Admin reconciliation support

### ⭐ Reviews & Ratings
- Job-based reviews only (no fake ratings)
- Employer responses
- Public rating statistics

### 🔔 Notifications
- In-app notifications
- Read / unread tracking
- Push notification ready (Firebase FCM)

---

## 🧠 Job Allocation Logic (Key USP)

### Offline Jobs
- First-Come-First-Serve (FCFS)
- No skill or profile evaluation
- Applications auto-close after limit
- Ideal for cafes, helpers, delivery jobs

### Online Jobs
- Profile URL required (LinkedIn / GitHub / Portfolio)
- System evaluates profile automatically
- Shortlisting starts after employer-defined time window
- Only top candidates reach employer (others silently rejected)

---

## 📈 Student Skill Score System (System-Driven)

Students **cannot** edit their score.

| Event | Score Change |
|------|-------------|
| New student signup | +35 |
| Job completed | +8 |
| On-time submission | +4 |
| Rejected / poor behavior | -5 |
| No-show / fraud | -20 |

Stored as:
```js
skillScore: Number



Tech Stack
Node.js + Express
MongoDB + Mongoose
JWT Authentication
Razorpay Payments
Firebase Cloud Messaging (optional)
Render (deployment ready)




### Project Structure
backend/
│── controllers/
│── routes/
│── models/
│── services/
│── middleware/
│── utils/
│── server.js
│── .env.example




⚙️ Environment Variables

Create a .env file in root:
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/jobmarketplace

JWT_SECRET=your_jwt_secret

RAZORPAY_KEY_ID=xxxx
RAZORPAY_KEY_SECRET=xxxx
PLATFORM_COMMISSION_RATE=0.05

FIREBASE_PROJECT_ID=xxxx
FIREBASE_CLIENT_EMAIL=xxxx
FIREBASE_PRIVATE_KEY=xxxx




###Running Locally
npm install
node server.js


Server runs on:
http://localhost:5000

✅ API Status

All APIs tested using Postman
Wallet consistency verified
Escrow & transaction safety confirmed
Notification flows validated
Reviews & scoring logic tested


🚀 Roadmap

Mobile App (React Native / Flutter)
In-app student portfolio builder
AI-based profile evaluation
Real-time chat system
Automated fraud detection


👨‍💻 Author

Shivanshu Kushwaha
Backend Developer
