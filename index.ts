import express from 'express';
import { PrismaClient } from '@prisma/client';
import cron from 'node-cron';
import dotenv from 'dotenv';
import crypto from 'crypto';
import axios from 'axios';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';

// --- ZERO-COST SMS ENGINE (SMTP) ---
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'ezekiel.grayson.johnson@gmail.com', // <-- 1. Type your real Gmail address here
    pass: 'qjnw rjxh awth ecga'   // <-- 2. Paste your 16-letter App Password here
  }
});

// Tell TypeScript that our secure session will hold a companyId
declare module 'express-session' {
  interface SessionData {
    companyId: string;
  }
}

dotenv.config();

const app = express();
const prisma = new PrismaClient();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// --- AUTO-SEED LEGAL THRESHOLDS (THE AMERICAN WEST) ---
  const laws = [
    // States with specific wildfire smoke standards
    { stateCode: "OR", maxAqi: 101 }, // Oregon OSHA standard
    { stateCode: "CA", maxAqi: 151 }, // Cal/OSHA standard
    { stateCode: "WA", maxAqi: 151 }, // Washington L&I standard
    
    // States defaulting to the Federal OSHA/EPA standard
    { stateCode: "MT", maxAqi: 151 },
    { stateCode: "WY", maxAqi: 151 },
    { stateCode: "CO", maxAqi: 151 },
    { stateCode: "NM", maxAqi: 151 },
    { stateCode: "ID", maxAqi: 151 },
    { stateCode: "UT", maxAqi: 151 },
    { stateCode: "AZ", maxAqi: 151 },
    { stateCode: "NV", maxAqi: 151 },
    { stateCode: "AK", maxAqi: 151 },
    { stateCode: "HI", maxAqi: 151 }
  ];

// --- SECURITY MIDDLEWARE ---
app.use(session({
  secret: 'osha-super-secret-key-2026', // In production, this goes in your .env file
  resave: false,
  saveUninitialized: false
}));

// --- THE AUTOMATED ENGINE (SIMULATION MODE) ---
async function runAirQualityCheck() {
  // 1. Get all active worksites and INCLUDE the company data (This fixes the admin errors!)
  const worksites = await prisma.worksite.findMany({
    where: { isActive: true },
    include: { company: true }
  });

  for (const site of worksites) {
    try {
      // 2. Fetch the specific state law
      const stateLaw = await prisma.stateRegulation.findUnique({
        where: { stateCode: site.state }
      });

      // 3. Extract the dual-tier thresholds (Default to 151 if no law exists)
      const voluntaryLimit = stateLaw?.voluntaryAqi || 151;
      const mandatoryLimit = stateLaw?.mandatoryAqi || 9999; 

      // 4. Ping the Weather API (Generating up to 300 so we can test mandatory limits)
      const liveAirNowAqi = Math.floor(Math.random() * (300 - 80 + 1) + 80);
      console.log(`📍 ${site.incidentName} (${site.state}): Live AQI is ${liveAirNowAqi}`);

      // 5. Compare Live Weather against Dual-Tier Laws
      let alertLevel = "";
      if (liveAirNowAqi >= mandatoryLimit) {
        alertLevel = "MANDATORY";
      } else if (liveAirNowAqi >= voluntaryLimit) {
        alertLevel = "VOLUNTARY";
      }

      // 6. Fire Alerts if a threshold is broken
      if (alertLevel !== "") {
        console.log(`⚠️ HAZARD DETECTED! Limit Exceeded. Logging API data...`);
        console.log(`======================================================`);

        try {
          // SMS to Crew Lead
          await transporter.sendMail({
            from: '"Alert Air Compliance" <ezekiel.grayson.johnson@gmail.com>',
            to: `${site.foremanPhone}${site.carrier}`,
            subject: 'OSHA ALERT',
            text: `URGENT (${alertLevel}): AQI at ${site.incidentName} hit ${liveAirNowAqi}. N95 protocols triggered for ${site.company.name}. Sign off: https://alert-air-ezio.onrender.com/signoff/${site.id}`
          });
          console.log(`✅ ZERO-COST SMS successfully sent to ${site.crewLeadName} at ${site.foremanPhone}${site.carrier}!`);

          // SMS to Admin (CC)
          if (site.company.adminPhone && site.company.adminCarrier) {
            try {
              await transporter.sendMail({
                from: '"Alert Air Compliance" <ezekiel.grayson.johnson@gmail.com>',
                to: `${site.company.adminPhone}${site.company.adminCarrier}`,
                subject: 'ADMIN ALERT',
                text: `ADMIN ALERT: Hazard detected at ${site.incidentName}. Crew lead ${site.crewLeadName} has been notified to distribute N95s. Awaiting signature.`
              });
              console.log(`✅ Admin CC'd at ${site.company.adminPhone}!`);
            } catch (adminErr) {
              console.log(`❌ Failed to send Admin SMS.`, adminErr);
            }
          }
        } catch (emailError) {
          console.log(`❌ Failed to send gateway SMS:`, emailError);
        }
        console.log(`======================================================\n`);
      } else {
        console.log(`✅ Safe conditions. No action required.`);
      }
    } catch (error) {
      console.log(`❌ Failed to process site ${site.incidentName}.`);
    }
  }
}

cron.schedule('0 * * * *', runAirQualityCheck);

app.get('/trigger', async (req, res) => {
  await runAirQualityCheck();
  res.send("<h2 style='color: green; font-family: sans-serif;'>✅ Manual check triggered! Look at your VS Code terminal.</h2>");
});

// --- THE SIGN-UP PORTAL ---
app.get('/signup', (req, res) => {
  res.send(`
    <html>
      <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f4f7f6; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
        <div style="background: white; padding: 3rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); width: 320px; text-align: center;">
          <div style="text-align: center; margin-bottom: 2rem;">
  <h1 style="color: #0275d8; font-size: 22px; margin: 0; letter-spacing: -0.5px;">Alert Air Wildfire Compliance</h1>
  <p style="color: #6c757d; margin-top: 8px; margin-bottom: 0; font-size: 14px; font-weight: 500;">Contractor Registration</p>
</div>
          <form action="/signup" method="POST" style="display: flex; flex-direction: column; gap: 1.5rem;">
            <input type="text" name="companyName" placeholder="Company Name" required style="padding: 12px; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem;">
            <input type="email" name="email" placeholder="Admin Email" required style="padding: 12px; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem;">
            <input type="password" name="password" placeholder="Create Password" required style="padding: 12px; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem;">
            <input type="text" name="adminPhone" placeholder="Admin Cell (10 Digits)" style="padding: 12px; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem;">
            <select name="adminCarrier" style="padding: 12px; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem; background: white;">
              <option value="">Select Admin Carrier...</option>
              <option value="@vtext.com">Verizon</option>
              <option value="@txt.att.net">AT&T</option>
              <option value="@tmomail.net">T-Mobile</option>
            </select>
            <button type="submit" style="background: #5cb85c; color: white; border: none; padding: 12px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 1rem;">Create Account</button>
          </form>
          <p style="margin-top: 1.5rem; font-size: 14px; color: #666;">Already registered? <a href="/login" style="color: #0275d8; text-decoration: none; font-weight: bold;">Login here</a></p>
        </div>
      </body>
    </html>
  `);
});

app.post('/signup', async (req, res) => {
  const { companyName, email, password, adminPhone, adminCarrier } = req.body;

  // 1. Check if the email is already taken
  const existingCompany = await prisma.company.findUnique({ where: { contact: email } });
  if (existingCompany) {
    return res.send("<h2 style='text-align:center; margin-top:2rem; font-family:sans-serif;'>❌ Email already in use. <a href='/login'>Login</a></h2>");
  }

  // 2. Cryptographically hash the password (salt 10 rounds)
  const hashedPassword = await bcrypt.hash(password, 10);

  // 3. Save the new company with the protected password
  const newCompany = await prisma.company.create({
    data: {
      name: companyName,
      contact: email,
      password: hashedPassword,
      adminPhone: adminPhone,
      adminCarrier: adminCarrier
    }
  });

  // 4. Log them in instantly and send them to the dashboard
  req.session.companyId = newCompany.id;
  res.redirect('/admin');
});

// --- THE LOGIN PORTAL ---
app.get('/login', (req, res) => {
  res.send(`
    <html>
      <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f4f7f6; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
        <div style="background: white; padding: 3rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); width: 320px; text-align: center;">
          <div style="text-align: center; margin-bottom: 2rem;">
  <h1 style="color: #0275d8; font-size: 22px; margin: 0; letter-spacing: -0.5px;">Alert Air Wildfire Compliance</h1>
  <p style="color: #6c757d; margin-top: 8px; margin-bottom: 0; font-size: 14px; font-weight: 500;">Secure Portal Login</p>
</div>
          <form action="/login" method="POST" style="display: flex; flex-direction: column; gap: 1.5rem;">
            <input type="email" name="email" placeholder="Admin Email" required style="padding: 12px; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem;">
            <input type="password" name="password" placeholder="Password" required style="padding: 12px; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem;">
            <button type="submit" style="background: #0275d8; color: white; border: none; padding: 12px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 1rem;">Authenticate</button>
          </form>
          <p style="margin-top: 1.5rem; font-size: 14px; color: #666;">New contractor? <a href="/signup" style="color: #5cb85c; text-decoration: none; font-weight: bold;">Register here</a></p>
        </div>
      </body>
    </html>
  `);
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  
  // 1. Look up the company
  const company = await prisma.company.findUnique({ where: { contact: email } });
  
  // 2. If the company exists, compare the entered password against the hashed password
  if (company && await bcrypt.compare(password, company.password)) {
    req.session.companyId = company.id; // Lock it in!
    res.redirect('/admin');
  } else {
    res.send("<h2 style='color: #d9534f; text-align: center; font-family: sans-serif; margin-top: 3rem;'>❌ Access Denied: Invalid Email or Password. <a href='/login'>Try Again</a></h2>");
  }
});

// --- LOGOUT ROUTE ---
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

// --- THE WORKSITE MANAGEMENT API ---
app.post('/api/worksite', async (req, res) => {
  if (!req.session.companyId) return res.redirect('/login');

  // UPDATED: Now pulling 'carrier' from the dropdown form
  const { incidentName, state, latitude, longitude, crewLeadName, foremanPhone, carrier } = req.body;
  
  await prisma.worksite.create({
    data: {
      incidentName,
      state,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      crewLeadName,
      foremanPhone, // Saves just the numbers
      carrier,      // Saves the @vtext.com gateway
      companyId: req.session.companyId 
    }
  });
  res.redirect('/admin');
});

// --- UPDATE CREW API ---
app.post('/api/worksite/:id/update-crew', async (req, res) => {
  if (!req.session.companyId) return res.redirect('/login');

  const worksiteId = req.params.id;
  const { newPhone, newName } = req.body;

  const worksite = await prisma.worksite.findUnique({ where: { id: worksiteId } });
  
  if (worksite && worksite.companyId === req.session.companyId) {
    await prisma.worksite.update({
      where: { id: worksiteId },
      data: { 
        foremanPhone: newPhone, 
        crewLeadName: newName 
      }
    });
  }
  res.redirect('/admin');
});

// --- PUBLIC LANDING PAGE (THE SALES PITCH) ---
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Alert Air | Wildfire Smoke Compliance</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-50 text-gray-900 font-sans antialiased">
      
      <header class="bg-slate-900 text-white py-20 px-6 border-b-8 border-red-600">
        <div class="max-w-4xl mx-auto text-center">
          <h1 class="text-4xl md:text-6xl font-black mb-6 tracking-tight">Don’t Let a Smoke Audit Kill Your Government Bids.</h1>
          <p class="text-xl md:text-2xl text-slate-300 font-medium mb-10 max-w-3xl mx-auto">
            State OSHA agencies are hammering wildfire crews with surprise air quality inspections. One missing paper logbook can blacklist your business.
          </p>
          <a href="/signup" class="inline-block bg-red-600 hover:bg-red-700 text-white font-bold text-lg py-4 px-10 rounded-lg shadow-lg transition-transform transform hover:scale-105">
  Protect Your Crews Today
</a>
        </div>
      </header>

      <section class="py-16 px-6 max-w-5xl mx-auto">
        <div class="text-center mb-12">
          <h2 class="text-3xl font-black text-red-600 uppercase tracking-wide">The Warning Period is Over.</h2>
          <p class="text-lg text-gray-600 mt-2 font-medium">Cal/OSHA and L&I are running targeted sweeps. They aren't handing out warnings anymore.</p>
        </div>

        <div class="grid md:grid-cols-2 gap-8">
          <div class="bg-white p-8 rounded-xl shadow-md border-t-4 border-red-500">
            <h3 class="text-2xl font-black mb-4">The Financial Devastation</h3>
            <ul class="space-y-4 text-gray-700 font-medium">
              <li class="flex items-start">
                <span class="text-red-500 mr-2">🚨</span>
                <div><strong class="text-gray-900">$16,550 Fine:</strong> Missing the timestamped proof that you checked the AQI before a shift.</div>
              </li>
              <li class="flex items-start">
                <span class="text-red-500 mr-2">🚨</span>
                <div><strong class="text-gray-900">$165,514 Fine:</strong> Willful violations, like falsifying paper logs or failing repeat audits.</div>
              </li>
            </ul>
          </div>

          <div class="bg-white p-8 rounded-xl shadow-md border-t-4 border-slate-800">
            <h3 class="text-2xl font-black mb-4">The "Silent Debarment"</h3>
            <p class="text-gray-700 font-medium mb-4">
              Writing a $16,000 check hurts. Losing your USFS VIPR dispatch priority will bankrupt you.
            </p>
            <p class="text-gray-700 font-medium">
              Agencies use your OSHA 300 log to determine if you are a "responsible bidder." If you have open smoke violations, dispatch centers simply move you to the bottom of the list. Your equipment sits in the yard all summer.
            </p>
          </div>
        </div>
      </section>

      <section class="bg-slate-200 py-16 px-6 border-y border-slate-300">
        <div class="max-w-5xl mx-auto">
          <h2 class="text-3xl font-black text-center mb-12">How Alert Air Protects You</h2>
          <div class="grid md:grid-cols-3 gap-6 text-center">
            <div class="bg-white p-6 rounded-lg shadow">
              <div class="text-4xl mb-4">📡</div>
              <h4 class="text-xl font-bold mb-2">Zero-Touch Tracking</h4>
              <p class="text-gray-600 text-sm">We ping the official EPA API for your exact crew coordinates every hour. You never have to guess the AQI.</p>
            </div>
            <div class="bg-white p-6 rounded-lg shadow">
              <div class="text-4xl mb-4">📱</div>
              <h4 class="text-xl font-bold mb-2">Instant SMS Alerts</h4>
              <p class="text-gray-600 text-sm">When the air hits state-mandated limits, your crew lead instantly gets a text to distribute N95 respirators.</p>
            </div>
            <div class="bg-white p-6 rounded-lg shadow border-2 border-green-500">
              <div class="text-4xl mb-4">⚖️</div>
              <h4 class="text-xl font-bold mb-2">Immutable Ledger</h4>
              <p class="text-gray-600 text-sm">Crew leads sign off digitally. When the auditor shows up, you hand them a flawless cryptographic paper trail.</p>
            </div>
          </div>
        </div>
      </section>

      <section class="py-20 px-6 max-w-3xl mx-auto text-center">
        <h2 class="text-4xl font-black mb-6">Simple, Blue-Collar Pricing</h2>
        <div class="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-200">
          <div class="bg-green-600 text-white py-6">
            <span class="text-5xl font-black">$100</span>
            <span class="text-xl font-medium">/ month per active crew</span>
          </div>
          <div class="p-8">
            <ul class="text-left space-y-4 text-lg font-medium text-gray-700 w-fit mx-auto mb-8">
              <li>✅ <strong class="text-gray-900">Zero Setup Fees.</strong> Up and running in 5 minutes.</li>
              <li>✅ <strong class="text-gray-900">No Annual Contracts.</strong> Cancel anytime.</li>
              <li>✅ <strong class="text-gray-900">Zero Off-Season Waste.</strong> Only pay for deployed crews. Demobilize them in the winter and your bill drops to $0.</li>
            </ul>
            <a href="/signup" class="block w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xl py-4 rounded-lg shadow transition-colors">
  Start Your 14-Day Free Trial
</a>
          </div>
        </div>
      </section>

      <footer class="text-center py-8 text-gray-500 text-sm">
        <p>&copy; 2026 Alert Air Wildfire Compliance. All rights reserved.</p>
      </footer>
    </body>
    </html>
  `);
});

// 2. THE WORKER SIGN-OFF PORTAL (UPDATED WITH SIGNATURE)
app.get('/signoff/:id', (req, res) => {
  const siteId = req.params.id;

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Safety Acknowledgment</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-900 flex items-center justify-center min-h-screen p-4">
      <div class="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full text-center border-t-8 border-red-600">
        <div class="text-red-600 mb-4 flex justify-center">
          <svg class="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
        </div>
        <h1 class="text-2xl font-black text-slate-900 mb-2 tracking-tight">HAZARD DETECTED</h1>
        <p class="text-slate-600 mb-6 font-medium">Air quality has reached hazardous levels. By signing below, I confirm all personnel have been issued N95 respirators.</p>
        
        <form action="/signoff-submit" method="POST" class="text-left">
          <input type="hidden" name="siteId" value="${siteId}">
          
          <div class="mb-6">
            <label class="block text-slate-700 text-sm font-bold mb-2 uppercase tracking-wide" for="signature">
              Crew Lead Electronic Signature
            </label>
            <input class="shadow-sm appearance-none border-2 border-slate-200 rounded-lg w-full py-3 px-4 text-slate-900 leading-tight focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition" id="signature" name="signature" type="text" placeholder="Type your full legal name" required>
          </div>

          <button type="submit" class="w-full bg-red-600 text-white font-bold py-4 rounded-lg hover:bg-red-700 transition shadow-lg text-lg tracking-wide">
            I ACKNOWLEDGE & COMPLY
          </button>
        </form>
      </div>
    </body>
    </html>
  `);
});

// 3. THE COMPLIANCE CATCHER
// Note: express.urlencoded is required to read form data!
app.post('/signoff-submit', async (req, res) => {
  const { siteId, signature } = req.body;

try {
    // 1. Lock the signature into the database permanently
    await prisma.signOff.create({
      data: {
        siteId: siteId,
        signature: signature,
      }
    });

    // 2. Fetch the worksite and company details to notify the admin
    const site = await prisma.worksite.findUnique({
      where: { id: siteId },
      include: { company: true }
    });

    // 3. Text the Admin that compliance is secured!
    if (site && site.company.adminPhone && site.company.adminCarrier) {
      try {
        await transporter.sendMail({
          from: '"Alert Air Compliance" <ezekiel.grayson.johnson@gmail.com>',
          to: `${site.company.adminPhone}${site.company.adminCarrier}`,
          subject: 'COMPLIANCE SECURED',
          text: `COMPLIANCE SECURED: Crew lead ${signature} has officially signed off on N95 distribution for ${site.incidentName}.`
        });
        console.log(`✅ Admin notified of compliance for ${site.incidentName}`);
      } catch (adminErr) {
        console.error("Failed to CC admin:", adminErr);
      }
    }

    // Show the success screen so they know they are clear
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Compliance Logged</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-slate-900 flex items-center justify-center min-h-screen p-4">
        <div class="text-center">
          <div class="text-emerald-500 mb-6 flex justify-center">
             <svg class="w-24 h-24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          </div>
          <h1 class="text-4xl font-black text-white mb-4 tracking-tight">Signature Logged</h1>
          <p class="text-lg text-slate-400 font-medium max-w-sm mx-auto">Your compliance record has been securely timestamped and attached to the worksite file. It is safe to close this page.</p>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error("Failed to log signature:", error);
    res.status(500).send("Database Error. Please try again.");
  }
});

// --- TEMPORARY ROUTE: INJECT STATE LAWS INTO DATABASE ---
app.get('/admin/seed-laws', async (req, res) => {
  await prisma.stateRegulation.createMany({
    data: [
      { stateCode: 'CA', voluntaryAqi: 151, mandatoryAqi: 501 },
      { stateCode: 'OR', voluntaryAqi: 101, mandatoryAqi: 251 },
      { stateCode: 'WA', voluntaryAqi: 69,  mandatoryAqi: 101 },
      { stateCode: 'NV', voluntaryAqi: 151, mandatoryAqi: null },
      { stateCode: 'ID', voluntaryAqi: 151, mandatoryAqi: null },
      { stateCode: 'MT', voluntaryAqi: 151, mandatoryAqi: null },
      { stateCode: 'UT', voluntaryAqi: 151, mandatoryAqi: null },
      { stateCode: 'AZ', voluntaryAqi: 151, mandatoryAqi: null },
      { stateCode: 'CO', voluntaryAqi: 151, mandatoryAqi: null },
      { stateCode: 'WY', voluntaryAqi: 151, mandatoryAqi: null },
      { stateCode: 'NM', voluntaryAqi: 151, mandatoryAqi: null },
    ],
    skipDuplicates: true // Prevents errors if you run it twice
  });
  res.send("<h1 style='color: green; font-family: sans-serif; text-align: center; margin-top: 3rem;'>✅ State Laws Injected Successfully!</h1>");
});

// --- THE AUDIT DASHBOARD ---
app.get('/admin', async (req, res) => {
  // 1. THE BOUNCER: If you don't have a session key, go back to the login page!
  if (!req.session.companyId) {
    return res.redirect('/login');
  }

// 2. THE SILO: Only pull worksites that belong to the securely logged-in company
  const worksites = await prisma.worksite.findMany({
    where: { companyId: req.session.companyId }, 
    include: { signOffs: { orderBy: { timestamp: 'desc' } } },
    orderBy: { isActive: 'desc' }
  });

// 3. BUILD THE TABLE ROWS
  const rows = worksites.map(site => {
    const statusBadge = site.isActive 
      ? `<span style="background: #d4edda; color: #155724; padding: 4px 8px; border-radius: 4px; font-weight: bold;">On-Site</span>`
      : `<span style="background: #f8d7da; color: #721c24; padding: 4px 8px; border-radius: 4px; font-weight: bold;">Demobilized</span>`;

    const toggleAction = site.isActive ? 'Demobilize Crew' : 'Remobilize Crew';
    const buttonColor = site.isActive ? '#f0ad4e' : '#5cb85c';

    return `
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 16px;"><strong>${site.incidentName}</strong></td>
        <td style="padding: 16px;">${statusBadge}</td>
        
        <td style="padding: 16px;">
          <form action="/api/worksite/${site.id}/update-crew" method="POST" style="display: flex; flex-direction: column; gap: 6px; margin: 0;">
            <input type="text" name="newName" value="${site.crewLeadName}" placeholder="Lead Name" style="padding: 6px; border: 1px solid #ccc; border-radius: 4px; width: 140px; font-size: 13px;">
            <input type="text" name="newPhone" value="${site.foremanPhone}" placeholder="Phone Number" style="padding: 6px; border: 1px solid #ccc; border-radius: 4px; width: 140px; font-size: 13px;">
            <button type="submit" style="background: #6c757d; color: white; border: none; padding: 6px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold;">Update Crew</button>
          </form>
        </td>

        <td style="padding: 16px;">
          <form action="/api/worksite/${site.id}/toggle" method="POST" style="margin: 0;">
            <button type="submit" style="background: ${buttonColor}; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-weight: bold;">${toggleAction}</button>
          </form>
        </td>
<td style="padding: 16px; color: #555; font-size: 13px; max-width: 250px;">
          ${site.signOffs.length === 0 
            ? '<span style="color: #dc3545; font-weight: bold;">⚠️ Pending</span>' 
            : site.signOffs.map(sig => `
                <div style="margin-bottom: 4px;">
                  ✅ <strong>${sig.signature}</strong><br>
                  <span style="font-size: 11px; color: #888;">${new Date(sig.timestamp).toLocaleString()}</span>
                </div>
              `).join('<hr style="border: 0; border-top: 1px solid #eee; margin: 8px 0;">')
          }
        </td>
      </tr>
    `;
  }).join('');

res.send(`
    <html>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f7f6; padding: 3rem; color: #333; margin: 0;">
        <div style="max-width: 1000px; margin: 0 auto;">
            
            <div style="background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); margin-bottom: 2rem;">
              <h2 style="margin-top: 0; color: #2c3e50;">➕ Deploy New Monitor</h2>
              <form action="/api/worksite" method="POST" style="display: flex; gap: 1rem; flex-wrap: wrap; align-items: center;">
                  <input type="text" name="incidentName" placeholder="Fire Name (e.g. Dixie Fire)" required style="padding: 10px; border: 1px solid #ccc; border-radius: 4px; flex: 1; min-width: 200px;">
                  
                  <select name="state" required style="padding: 10px; border: 1px solid #ccc; border-radius: 4px; width: 100px; background: white;">
                    <option value="" disabled selected>State</option>
                    <option value="CA">CA</option>
                    <option value="OR">OR</option>
                    <option value="WA">WA</option>
                    <option value="NV">NV</option>
                    <option value="ID">ID</option>
                    <option value="MT">MT</option>
                    <option value="UT">UT</option>
                    <option value="AZ">AZ</option>
                    <option value="CO">CO</option>
                    <option value="WY">WY</option>
                    <option value="NM">NM</option>
                  </select>

                  <input type="number" step="any" name="latitude" placeholder="Latitude" required style="padding: 10px; border: 1px solid #ccc; border-radius: 4px; width: 120px;">
                  <input type="number" step="any" name="longitude" placeholder="Longitude" required style="padding: 10px; border: 1px solid #ccc; border-radius: 4px; width: 120px;">
                  <input type="text" name="crewLeadName" placeholder="Crew Lead Name" required style="padding: 10px; border: 1px solid #ccc; border-radius: 6px;">
                  <input type="text" name="foremanPhone" placeholder="10-Digit Phone" required style="padding: 10px; border: 1px solid #ccc; border-radius: 6px;">

                  <select name="carrier" required style="padding: 10px; border: 1px solid #ccc; border-radius: 6px; background: white;">
                    <option value="">Select Carrier...</option>
                    <option value="@vtext.com">Verizon</option>
                    <option value="@txt.att.net">AT&T</option>
                    <option value="@tmomail.net">T-Mobile</option>
                  </select>

                  <button type="submit" style="background: #5cb85c; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: bold;">Deploy New Monitor</button>
              </form>
            </div>

            <div style="background: white; padding: 3rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.05);">
              <div style="border-bottom: 2px solid #eee; padding-bottom: 1rem; margin-bottom: 2rem;">
                <h1 style="color: #0275d8; font-size: 26px; margin: 0; letter-spacing: -0.5px;">Alert Air Wildfire Compliance</h1>
                <p style="color: #6c757d; margin-top: 6px; margin-bottom: 0; font-size: 15px; font-weight: 500;">Active Command Center</p>
                
                <a href="/admin/audit" style="display: inline-block; background: #28a745; color: white; padding: 10px 15px; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 15px;">📜 View Audit Ledger</a>
              </div>
              
              <div style="overflow-x: auto; width: 100%;">
                <table style="width: 100%; min-width: 800px; border-collapse: collapse; text-align: left;">
                  <thead>
                    <tr style="background: #f8f9fa; border-bottom: 2px solid #dee2e6; color: #495057; font-size: 14px;">
                      <th style="padding: 12px 16px;">INCIDENT NAME</th>
                      <th style="padding: 12px 16px;">STATUS</th>
                      <th style="padding: 12px 16px;">CREW LEAD DETAILS</th>
                      <th style="padding: 12px 16px;">ACTIONS</th>
                      <th style="padding: 12px 16px;">COMPLIANCE LOGS</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rows}
                  </tbody>
                </table>
              </div>
            </div>
        </div>
      </body>
    </html>
  `);
});

// --- THE MOBILE SIGNOFF PAGE (NATIVE APP UPGRADE) ---
app.get('/signoff/:worksiteId/:logId', async (req, res) => {
  res.send(`
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f7f6; margin: 0; padding: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
          .app-container { background: white; width: 100%; max-width: 400px; height: 100vh; max-height: 850px; display: flex; flex-direction: column; box-shadow: 0 0 20px rgba(0,0,0,0.1); }
          .header { background: #d9534f; color: white; padding: 20px; text-align: center; }
          .header h2 { margin: 0; font-size: 1.4rem; }
          .content { padding: 20px; flex-grow: 1; display: flex; flex-direction: column; }
          .warning-text { font-size: 1.1rem; color: #333; line-height: 1.5; margin-bottom: 20px; }
          .canvas-container { border: 2px dashed #ccc; border-radius: 8px; background: #fafafa; margin-bottom: 10px; position: relative; }
          canvas { width: 100%; height: 200px; touch-action: none; cursor: crosshair; }
          .controls { display: flex; justify-content: flex-end; margin-bottom: 20px; }
          .clear-btn { background: none; border: none; color: #6c757d; font-weight: bold; cursor: pointer; padding: 5px; }
          .submit-btn { background: #5cb85c; color: white; border: none; padding: 18px; font-size: 1.3rem; font-weight: bold; border-radius: 8px; cursor: pointer; width: 100%; margin-top: auto; }
        </style>
      </head>
      <body>
        <div class="app-container">
            <div class="header">
                <h2>⚠️ OSHA Compliance</h2>
            </div>
            <div class="content">
                <p class="warning-text">By signing below, I legally certify that <strong>N95 respirators</strong> have been distributed to the crew as required by state wildfire regulations.</p>
                
                <form id="signForm" action="/api/signoff" method="POST" style="display: flex; flex-direction: column; flex-grow: 1;">
                    <input type="hidden" name="worksiteId" value="${req.params.worksiteId}">
                    <input type="hidden" name="logId" value="${req.params.logId}">
                    <input type="hidden" name="signatureData" id="signatureData" value="">
                    
                    <div class="canvas-container">
                        <canvas id="signaturePad"></canvas>
                    </div>
                    <div class="controls">
                        <button type="button" id="clearBtn" class="clear-btn">Clear Signature</button>
                    </div>
                    
                    <button type="submit" class="submit-btn">Submit Record</button>
                </form>
            </div>
        </div>

        <script>
            const canvas = document.getElementById('signaturePad');
            const ctx = canvas.getContext('2d');
            let isDrawing = false;

            function resize() {
                canvas.width = canvas.offsetWidth;
                canvas.height = canvas.offsetHeight;
            }
            window.addEventListener('resize', resize);
            resize();

            function startPosition(e) {
                isDrawing = true;
                draw(e);
            }
            function endPosition() {
                isDrawing = false;
                ctx.beginPath();
            }
            function draw(e) {
                if (!isDrawing) return;
                e.preventDefault();
                
                const rect = canvas.getBoundingClientRect();
                const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                
                ctx.lineWidth = 3;
                ctx.lineCap = 'round';
                ctx.strokeStyle = '#000';
                
                ctx.lineTo(clientX - rect.left, clientY - rect.top);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(clientX - rect.left, clientY - rect.top);
            }

            canvas.addEventListener('mousedown', startPosition);
            canvas.addEventListener('mouseup', endPosition);
            canvas.addEventListener('mousemove', draw);
            
            canvas.addEventListener('touchstart', startPosition, {passive: false});
            canvas.addEventListener('touchend', endPosition);
            canvas.addEventListener('touchmove', draw, {passive: false});

            document.getElementById('clearBtn').addEventListener('click', () => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            });

            document.getElementById('signForm').addEventListener('submit', (e) => {
                document.getElementById('signatureData').value = canvas.toDataURL();
            });
        </script>
      </body>
    </html>
  `);
});

// --- SAVING THE LEGAL RECORD ---
app.post('/api/signoff', async (req, res) => {
  const { worksiteId, logId, signatureData } = req.body;
  
  const signatureHash = crypto.createHash('sha256').update(signatureData + new Date().toISOString() + worksiteId).digest('hex');

  try {
    await prisma.complianceSignoff.create({
      data: { worksiteId, logId, signatureHash }
    });

    console.log(`✅ RECORD SECURED: Physical signature hashed and logged for worksite ${worksiteId}`);

    res.send(`
      <html>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center; padding: 3rem; background: white;">
              <div style="font-size: 4rem; margin-bottom: 1rem;">✅</div>
              <h2 style="color: #28a745; margin-bottom: 0.5rem;">Securely Logged</h2>
              <p style="color: #666; line-height: 1.5;">The hazard mitigation action and signature have been locked for audit defense. You may close this window.</p>
              <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px; margin-top: 2rem; word-break: break-all;">
                  <p style="color: #6c757d; font-size: 0.75rem; font-weight: bold; text-transform: uppercase; margin: 0 0 0.5rem 0;">Cryptographic Signature Hash</p>
                  <code style="color: #333; font-size: 0.85rem;">${signatureHash}</code>
              </div>
          </body>
      </html>
    `);
  } catch (error) {
    res.send("<h2 style='font-family: sans-serif; color: red; text-align: center; margin-top: 3rem;'>Error: This compliance log has already been signed!</h2>");
  }
});

// --- THE IMMUTABLE AUDIT LEDGER ---
app.get('/admin/audit', async (req, res) => {
  try {
    // 1. Fetch all sign-offs directly
    const logs = await prisma.complianceSignoff.findMany({
      orderBy: { createdAt: 'desc' } // Newest signatures first
    });

    // 2. Build the secure paper trail table by manually looking up the worksite
    let tableRows = "";
    for (const log of logs) {
      const worksite = await prisma.worksite.findUnique({
        where: { id: log.worksiteId },
        include: { company: true }
      });

      tableRows += `
        <tr style="border-bottom: 1px solid #e0e0e0;">
          <td style="padding: 12px; color: #555;">${new Date(log.createdAt).toLocaleString()}</td>
          <td style="padding: 12px; font-weight: bold;">${worksite?.company?.name || 'Unknown'}</td>
          <td style="padding: 12px;">${worksite?.incidentName || 'N/A'} (${worksite?.state || 'N/A'})</td>
          <td style="padding: 12px;">${worksite?.crewLeadName || 'Unknown'}</td>
          <td style="padding: 12px; font-family: monospace; color: #d63384; font-size: 0.85rem;">${log.signatureHash}</td>
        </tr>
      `;
    }

    // 3. Render the Dashboard
    res.send(`
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 1000px; margin: 40px auto; padding: 20px;">
        <h1 style="color: #111; margin-bottom: 5px;">⚖️ Compliance Audit Ledger</h1>
        <p style="color: #666; margin-bottom: 30px;">Cryptographically secured paper trail of crew lead N95 distribution sign-offs.</p>
        
        <div style="background: white; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
          <table style="width: 100%; border-collapse: collapse; text-align: left;">
            <thead style="background: #f8f9fa;">
              <tr>
                <th style="padding: 12px; border-bottom: 2px solid #e0e0e0;">Legal Timestamp</th>
                <th style="padding: 12px; border-bottom: 2px solid #e0e0e0;">Company</th>
                <th style="padding: 12px; border-bottom: 2px solid #e0e0e0;">Incident (State)</th>
                <th style="padding: 12px; border-bottom: 2px solid #e0e0e0;">Crew Lead</th>
                <th style="padding: 12px; border-bottom: 2px solid #e0e0e0;">Signature Hash</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows.length > 0 ? tableRows : '<tr><td colspan="5" style="padding: 30px; text-align: center; color: #999;">No compliance signatures logged yet.</td></tr>'}
            </tbody>
          </table>
        </div>
        
        <a href="/admin" style="display: inline-block; margin-top: 20px; text-decoration: none; color: #007bff; font-weight: 500;">&larr; Back to Deployments</a>
      </div>
    `);
  } catch (error) {
    console.error("Audit Ledger Error:", error);
    res.status(500).send("<h2 style='color: red; text-align: center;'>Failed to load the Audit Ledger.</h2>");
  }
});

// --- THE HEARTBEAT: AUTOMATED HOURLY CHECKS ---
cron.schedule('0 * * * *', () => {
  console.log('\n⏰ CRON TRIGGER: Initiating hourly Alert Air compliance check...');
  runAirQualityCheck();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔥 Alert Air Server running on port ${PORT}`));