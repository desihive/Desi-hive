require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();

app.use(cors()); 
app.use(express.json()); 
app.use(express.static(__dirname)); 

// Temporary memory for the 4-digit OTPs
let otpStore = {}; 

// STANDARD CONNECTION: Using your .env file
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Hive Database is Connected!"))
    .catch((err) => {
        console.log("❌ Database Connection Error: ", err.message);
    });

// --- INLINE USER MODEL (NOW WITH DATES!) ---
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    profession: { type: String, default: 'Student' },
    country: { type: String, default: 'India' },
    state: { type: String, default: 'Telangana' },
    city: { type: String, default: 'Hyderabad' },
    colony: { type: String, default: 'My Area' },
    location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], default: [0, 0] } 
    },
    // 👇 NEW DATE TRACKERS 👇
    signupDate: { type: Date, default: Date.now }, 
    lastLoginDate: { type: Date, default: Date.now } 
});

userSchema.index({ location: "2dsphere" });
const User = mongoose.models.User || mongoose.model('User', userSchema);

// Secure Gmail Setup
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, 
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// --- 1. DYNAMIC SOS TRIGGER API ---
app.post('/api/sos-trigger', async (req, res) => {
    try {
        const { name, message, lat, lng, category, scope, userCity, userState, userCountry } = req.body;
        let emailList = [];

        const safeCity = userCity ? userCity.trim() : "";
        const safeState = userState ? userState.trim() : "";
        const safeCountry = userCountry ? userCountry.trim() : "";

        try {
            let query = {};
            if (scope === 'city') {
                query = { city: new RegExp(safeCity, 'i') }; 
            } else if (scope === 'state') {
                query = { state: new RegExp(safeState, 'i') }; 
            } else if (scope === 'country') {
                query = { country: new RegExp(safeCountry, 'i') }; 
            } else {
                query = { city: new RegExp(safeCity, 'i') };
            }

            console.log(`\n🔍 BROADCASTING SOS... Scope: [${scope.toUpperCase()}]`);

            const targetedUsers = await User.find(query);
            emailList = targetedUsers.map(u => u.email);
            console.log(`👥 Found ${emailList.length} user(s) in this ${scope}.`);

        } catch (dbErr) {
            console.log("❌ Database search error:", dbErr);
        }

        if (emailList.length === 0) {
            return res.status(200).json({ success: true, helpersFound: 0, message: "No users in range." });
        }
        
        const mapLink = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

        const mailOptions = {
            from: `"🚨 DESI HIVE EMERGENCY" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER, 
            bcc: emailList.join(','), 
            subject: `URGENT: ${category} reported by ${name}!`,
            html: `
                <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, Arial, sans-serif;">
                    <tr>
                        <td align="center">
                            <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 500px; background-color: #ffffff; border: 2px solid #ef4444; border-radius: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                                <tr>
                                    <td align="center" style="padding: 30px;">
                                        <h2 style="color: #ef4444; margin: 0 0 25px 0; font-size: 24px; letter-spacing: 1px;">🚨 EMERGENCY ALERT 🚨</h2>
                                        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; border-radius: 12px; margin-bottom: 25px;">
                                            <tr>
                                                <td style="padding: 20px; text-align: left;">
                                                    <p style="margin: 0 0 12px 0; font-size: 16px; color: #0f172a;"><strong>Neighbor in distress:</strong> ${name}</p>
                                                    <p style="margin: 0 0 12px 0; font-size: 16px; color: #0f172a;"><strong>Emergency Type:</strong> <span style="color: #ef4444; font-weight: bold;">${category}</span></p>
                                                    <p style="margin: 0; font-size: 16px; color: #0f172a;"><strong>Message:</strong> "${message}"</p>
                                                </td>
                                            </tr>
                                        </table>
                                        <p style="text-align: center; font-size: 14px; color: #64748b; margin-bottom: 25px;">Click the button below to view their exact live location and navigate to them instantly:</p>
                                        <table width="100%" cellpadding="0" cellspacing="0">
                                            <tr>
                                                <td align="center">
                                                    <a href="${mapLink}" style="background-color: #ef4444; color: #ffffff; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: 900; font-size: 16px; display: inline-block; letter-spacing: 0.5px;">📍 OPEN LIVE GOOGLE MAP</a>
                                                </td>
                                            </tr>
                                        </table>
                                        <p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 30px;">Sent securely via the Desi Hive Community Safety Network<br>Scope Triggered: ${scope ? scope.toUpperCase() : 'LOCAL'}</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            `
        };

        await transporter.sendMail(mailOptions);
        res.status(200).json({ success: true, helpersFound: emailList.length, message: "SOS Broadcasted!" });
    } catch (error) {
        console.error("SOS Email Error:", error);
        res.status(500).json({ error: "SOS Broadcast failed" });
    }
});

// --- 2. RAKT SEWA BLOOD REQUEST API (NOW ROUTES TO USER!) ---
app.post('/api/blood-request', async (req, res) => {
    try {
        // We now pull the requesterEmail out of the frontend request
        const { donorName, requesterName, requesterEmail, bloodGroup, quantity, address } = req.body;

        const mailOptions = {
            from: `"🩸 DESI HIVE RAKT SEWA" <${process.env.EMAIL_USER}>`,
            to: requesterEmail, // <-- Sends directly to the user who clicked the button!
            subject: `URGENT: Blood Match Initiated for ${requesterName}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 500px; border: 2px solid #e11d48; border-radius: 16px; padding: 25px; margin: auto;">
                    <h2 style="color: #e11d48; margin-top: 0; text-align: center;">🩸 Rakt Sewa Match Initiated</h2>
                    <p>Namaste <strong>${requesterName}</strong>,</p>
                    <p>Your emergency request for <strong>${quantity} unit(s)</strong> of <strong>${bloodGroup}</strong> blood has been successfully registered.</p>
                    
                    <div style="background-color: #fff1f2; padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid #fecdd3;">
                        <p style="margin: 0 0 10px 0; color: #881337;"><strong>Matched Donor Profile:</strong> ${donorName}</p>
                        <p style="margin: 0; color: #881337;"><strong>Delivery Checkpoint:</strong> ${address}</p>
                    </div>
                    
                    <p style="color: #64748b; font-size: 13px; text-align: center;">The donor has been notified with your contact details. They will reach out to you directly to coordinate the donation.</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        res.status(200).json({ success: true, message: "Blood request sent successfully!" });
    } catch (error) {
        console.error("Blood Request Error:", error);
        res.status(500).json({ error: "Failed to send blood request." });
    }
});

// --- 3. SEND OTP API ---
app.post('/api/send-otp', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: "Email is required" });

        const otp = Math.floor(1000 + Math.random() * 9000).toString(); 
        otpStore[email] = otp; 

        const mailOptions = {
            from: '"Desi Hive Team" <' + process.env.EMAIL_USER + '>',
            to: email,
            subject: 'Your Desi Hive Verification Code',
            text: `Your OTP is: ${otp}. Please enter this on the website to continue.`
        };

        await transporter.sendMail(mailOptions);
        res.status(200).json({ message: "OTP was sent to your Gmail!" });
    } catch (error) {
        res.status(500).json({ error: "Failed to send email. Check your App Password." });
    }
});

// --- 4. VERIFY OTP API ---
app.post('/api/verify-otp', (req, res) => {
    const { email, otp } = req.body;
    if (otpStore[email] && otpStore[email] === otp) {
        delete otpStore[email]; 
        res.status(200).json({ success: true, message: "HURRAY! Success!" });
    } else {
        res.status(400).json({ success: false, message: "Wrong OTP! Please try again." });
    }
});

// --- 5. SIGNUP API (With Welcome Email) ---
app.post('/api/signup', async (req, res) => {
    try {
        const { name, email, password, profession, country, state, city, colony, lat, lng } = req.body;
        const userLat = lat ? parseFloat(lat) : 17.4500;
        const userLng = lng ? parseFloat(lng) : 78.3800;

        const newUser = new User({ 
            name, email, password, 
            profession: profession || 'Student', country: country || 'India', state: state || 'Telangana', city: city || 'Hyderabad', colony: colony || 'My Area',
            location: { type: "Point", coordinates: [userLng, userLat] } 
            // signupDate and lastLoginDate automatically generated!
        });
        
        await newUser.save();

        // SEND BEAUTIFUL WELCOME EMAIL
        try {
            const mailOptions = {
                from: '"Desi Hive Community" <' + process.env.EMAIL_USER + '>',
                to: email,
                subject: 'Welcome to Desi Hive, ' + name + '! 🐝',
                html: `
                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, Arial, sans-serif;">
                        <tr>
                            <td align="center">
                                <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 500px; background-color: #ffffff; border-top: 5px solid #2563eb; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                                    <tr>
                                        <td align="center" style="padding: 30px;">
                                            <div style="font-size: 40px; margin-bottom: 10px;">🐝</div>
                                            <h2 style="color: #1e293b; margin: 0 0 10px 0; font-size: 24px;">Welcome to Desi Hive!</h2>
                                            <p style="color: #64748b; font-size: 16px; margin-bottom: 25px;">Namaste, <strong>${name}</strong>!</p>
                                            
                                            <p style="color: #334155; text-align: left; font-size: 15px; line-height: 1.6;">You are now officially connected to your local neighborhood in <strong>${city}, ${state}</strong>. Desi Hive is your unified hub to connect, help, and thrive together.</p>
                                            
                                            <table width="100%" cellpadding="0" cellspacing="0" style="margin: 25px 0; background-color: #f1f5f9; border-radius: 8px;">
                                                <tr>
                                                    <td style="padding: 15px; text-align: left; color: #475569; font-size: 14px; line-height: 1.6;">
                                                        <strong>Here is what you can do right now:</strong><br><br>
                                                        🚨 <strong>SOS Triage:</strong> Instant emergency broadcasting.<br>
                                                        🩸 <strong>Rakt Sewa:</strong> Community blood donation network.<br>
                                                        🛍️ <strong>Desi Bazaar:</strong> Buy and sell locally.<br>
                                                        🤝 <strong>Gatherings & Jobs:</strong> Meet neighbors and find local work.
                                                    </td>
                                                </tr>
                                            </table>
                                            
                                            <p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 20px;">Welcome to the family. Let's make our hood stronger!<br>- The Desi Hive Team</p>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                `
            };
            await transporter.sendMail(mailOptions);
            console.log("✅ Welcome email securely sent to " + email);
        } catch (emailErr) {
            console.log("⚠️ Welcome email failed to send, but user was created:", emailErr);
        }

        res.status(201).json({ message: "Welcome to the Hive! Registration successful." });
    } catch (err) {
        console.error("❌ SIGNUP ERROR:", err);
        res.status(400).json({ error: "Signup failed. Email might already be in use." });
    }
});

// --- 6. LOGIN API (NOW TRACKS LAST LOGIN DATE) ---
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        
        if (!user) return res.status(404).json({ error: "User not found." });
        if (user.password !== password) return res.status(401).json({ error: "Incorrect password!" });

        // 👇 UPDATES THE DATE IN THE DATABASE 👇
        user.lastLoginDate = new Date();
        await user.save();

        res.status(200).json({ 
            message: "Login successful!", 
            user: { 
                name: user.name, profession: user.profession,
                country: user.country, state: user.state, city: user.city, colony: user.colony,
                lng: user.location.coordinates[0], lat: user.location.coordinates[1],
                lastLogin: user.lastLoginDate
            } 
        });
    } catch (err) {
        res.status(500).json({ error: "Server error during login." });
    }
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => { console.log(`🚀 Desi Hive Server running on http://localhost:${PORT}`); });