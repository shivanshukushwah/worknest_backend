const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const { PAYMENT_STATUS } = require('../utils/constants');

// CONFIGURATION
const EMPLOYER_EMAIL = 'musicalw28@gmail.com';
const AMOUNT_TO_ADD = 5000;

async function addManualFunds() {
    try {
        // Checking both common names for MongoDB URI
        const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
        
        if (!mongoUri) {
            console.error('Error: No MongoDB URI found in .env (tried MONGODB_URI and MONGO_URI)');
            process.exit(1);
        }

        console.log(`Connecting to: ${mongoUri.split('@')[1] || 'localhost'}...`);
        await mongoose.connect(mongoUri);
        console.log('Connected to MongoDB...');

        // 1. User find karein
        const user = await User.findOne({ email: EMPLOYER_EMAIL, role: 'employer' });
        if (!user) {
            console.error(`Employer with email ${EMPLOYER_EMAIL} not found!`);
            process.exit(1);
        }

        // 2. Wallet find/update karein
        let wallet = await Wallet.findOne({ user: user._id });
        if (!wallet) {
            console.log('Wallet not found for this user, creating new one...');
            wallet = new Wallet({ user: user._id, balance: 0 });
        }

        const oldBalance = wallet.balance;
        wallet.balance += AMOUNT_TO_ADD;
        await wallet.save();
        console.log(`Successfully updated! \nOld Balance: ${oldBalance} \nNew Balance: ${wallet.balance}`);

        // 3. Transaction record banayein (History ke liye)
        const transaction = new Transaction({
            user: user._id,
            type: 'deposit',
            amount: AMOUNT_TO_ADD,
            status: PAYMENT_STATUS.COMPLETED,
            description: 'Manual credit by Admin',
            completedAt: new Date()
        });

        await transaction.save();
        console.log('Transaction history created successfully!');

        console.log('Done!');
        process.exit(0);
    } catch (err) {
        console.error('Error occurred:', err);
        process.exit(1);
    }
}

addManualFunds();
