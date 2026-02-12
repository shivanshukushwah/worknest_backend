# Multiple Accounts Per Email Setup

## Overview
Users ab ek hi email se do accounts bana sakte hain:
- 1️⃣ **Student account** (job seeker)
- 2️⃣ **Employer account** (job poster)

## Changes Made

### 1. **User Model** (`models/User.js`)
- ❌ Removed `unique: true` from email field
- ✅ Added compound unique index: `email + role`
- Ab same email se different roles ke accounts bann sakte hain

### 2. **Registration** (`controllers/authController.js`)
- Old check: Email sirf ek baar register ho sakta tha
- New check: Email + role combination unique hai
- Same email se sirf ek student aur ek employer account bann sakta hai

### 3. **Login** (`controllers/authController.js`)
- **Required parameter**: `role` (student/employer)
- Query: `User.findOne({ email, role })`
- Login ke time user ko apni role select karni padegi

### 4. **New Endpoint**: Get Accounts for Email
```
POST /api/auth/accounts-for-email
Body: { email: "user@example.com" }

Response:
{
  "success": true,
  "email": "user@example.com",
  "accounts": [
    {
      "_id": "user-id-1",
      "email": "user@example.com",
      "role": "student",
      "name": "John Doe",
      "isProfileComplete": true
    },
    {
      "_id": "user-id-2",
      "email": "user@example.com",
      "role": "employer",
      "name": "John Doe",
      "businessName": "John's Cafe",
      "isProfileComplete": false
    }
  ]
}
```

### 5. **Validator Updates** (`validators/authValidator.js`)
- Login validator mein `role` parameter add kiya
- Role validation: `student` ya `employer` hona zaruri hai

## Frontend Updates Required

### Registration Flow (No Change)
```javascript
POST /api/auth/register
{
  name: "John Doe",
  email: "john@example.com",
  password: "password123",
  confirmPassword: "password123",
  role: "student", // or "employer"
  phone: "+919876543210",
  location: {...}, // for student
  businessName: {...} // for employer
}
```

### Login Flow (UPDATE REQUIRED)
**Old:**
```javascript
POST /api/auth/login
{
  email: "john@example.com",
  password: "password123"
}
```

**New:**
```javascript
POST /api/auth/login
{
  email: "john@example.com",
  password: "password123",
  role: "student" // ✅ REQUIRED - specify which account
}
```

### New Feature: Show Available Accounts
```javascript
POST /api/auth/accounts-for-email
{
  email: "john@example.com"
}
```

Frontend ko login se pehle user se poocha ja sakta hai:
- "Aapke paas is email se kaun kaun se accounts hain?"
- User apni choice select kare, phir password enter kare

## Database Migration

Agar purane data mein duplicates ho toh ye command chalaen:

```bash
# Duplicate entries remove karne ke liye (backup ke baad)
db.users.deleteMany({
  email: "duplicate@example.com",
  role: "student",
  _id: { $ne: ObjectId("keep-this-id") }
})
```

## Phone Number Handling

Phone abb bhi **unique** rahega per **optional** hai:
- Agar user do accounts banaega with different phones → allowed
- Agar dono mein same phone → error

Best practice: Different phone numbers use kren ya dono mein same phone register na kren

## Testing Checklist

- [ ] Same email se student account register kro
- [ ] Same email se employer account register kro
- [ ] Login ke time role specify kro
- [ ] `/accounts-for-email` endpoint test kro
- [ ] Password reset karo (ab user ke sab accounts ko reset option milega)
- [ ] Phone verification test kro

## Security Notes

1. **JWT Token**: Role automatically include hota hai token mein
2. **Auth Middleware**: Role-based checks pahle se hain, no changes needed
3. **Validation**: Email + Role combination check hota hai db level
4. **Phone**: Unique rehta hai to prevent confusion

## Rollback (Agar zaroorat ho)

```javascript
// Old setup restore karne ke liye:
userSchema.index({ email: 1 }, { unique: true })
// aur registration/login mein purani logic use kro
```
