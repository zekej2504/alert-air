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
async function seedLaws() {
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

  for (const law of laws) {
    await prisma.stateRegulation.upsert({
      where: { stateCode: law.stateCode },
      update: {}, // If it already exists, do nothing
      create: law // If it doesn't exist, create it
    });
  }
}
seedLaws();

// --- SECURITY MIDDLEWARE ---
app.use(session({
  secret: 'osha-super-secret-key-2026', // In production, this goes in your .env file
  resave: false,
  saveUninitialized: false
}));

// --- THE AUTOMATED ENGINE (SIMULATION MODE) ---
async function runAirQualityCheck() {
  console.log('\n📡 Initiating hourly OSHA smoke check for active worksites...');

  // 1. Get all active sites AND pull in their parent company details
  const activeSites = await prisma.worksite.findMany({
    where: { isActive: true },
    include: { company: true } 
  });

  for (const site of activeSites) {
    try {
      // 2. Look up the specific state law for this worksite
      const stateLaw = await prisma.stateRegulation.findUnique({
        where: { stateCode: site.state }
      });

      // If the state isn't in our DB, default to the Federal EPA standard (151)
      const legalLimit = stateLaw ? stateLaw.maxAqi : 151;

      // 3. Ping the Weather API 
      // (Simulating AirNow for now: generates a random live AQI between 80 and 180)
      const liveAirNowAqi = Math.floor(Math.random() * (180 - 80 + 1) + 80); 

      console.log(`📍 ${site.incidentName} (${site.state}): Live AQI is ${liveAirNowAqi}. Legal Limit is ${legalLimit}.`);

      // 4. Compare the Live Weather against the State Law
   if (liveAirNowAqi >= legalLimit) {
        console.log(`⚠️ HAZARD DETECTED! Limit Exceeded. Logging API data...`);
        console.log(`======================================================`);
        
        // FIRE THE ZERO-COST SMS VIA CARRIER GATEWAY
        try {
          await transporter.sendMail({
            from: '"Alert Air Compliance" <ezekiel.grayson.johnson@gmail.com>', 
            to: `${site.foremanPhone}${site.carrier}`, 
            subject: 'OSHA ALERT', 
            text: `⚠️ AQI at ${site.incidentName} hit ${liveAirNowAqi}. N95 respirators required for ${site.company.name}. Sign off: http://localhost:3000/signoff/${site.id}`
          });
          console.log(`✅ ZERO-COST SMS successfully sent to ${site.crewLeadName} at ${site.foremanPhone}${site.carrier}!`);
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
            <button type="submit" style="background: #5cb85c; color: white; border: none; padding: 12px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 1rem;">Create Account</button>
          </form>
          <p style="margin-top: 1.5rem; font-size: 14px; color: #666;">Already registered? <a href="/login" style="color: #0275d8; text-decoration: none; font-weight: bold;">Login here</a></p>
        </div>
      </body>
    </html>
  `);
});

app.post('/signup', async (req, res) => {
  const { companyName, email, password } = req.body;

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
      password: hashedPassword
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

// --- THE COMPLIANCE AUDIT DASHBOARD ---
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Alert Air Wildfire Compliance</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 flex items-center justify-center min-h-screen">
      <div class="text-center p-10 bg-white shadow-2xl rounded-2xl max-w-3xl border border-slate-100">
        <div class="mb-6 inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 text-blue-600">
          <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
        </div>
        <h1 class="text-5xl font-extrabold text-slate-900 mb-6 tracking-tight">Alert Air Wildfire Compliance</h1>
        <p class="text-xl text-slate-600 mb-10 leading-relaxed">Automated AQI monitoring and zero-touch hazard alerts for your remote crews. Stay compliant. Keep them safe.</p>
        <div class="flex justify-center gap-4">
          <a href="/admin" class="bg-blue-600 text-white px-8 py-4 rounded-lg font-bold hover:bg-blue-700 transition shadow-lg hover:shadow-xl">Open Dashboard</a>
        </div>
      </div>
    </body>
    </html>
  `);
});
app.get('/admin', async (req, res) => {
  // 1. THE BOUNCER: If you don't have a session key, go back to the login page!
  if (!req.session.companyId) {
    return res.redirect('/login');
  }

  // 2. THE SILO: Only pull worksites that belong to the securely logged-in company
  const worksites = await prisma.worksite.findMany({
    where: { companyId: req.session.companyId }, 
    include: { signoffs: true },
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
        <td style="padding: 16px; color: #555;">
          <strong>${site.signoffs.length}</strong> Signatures
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
                  <input type="text" name="state" placeholder="State (CA)" required style="padding: 10px; border: 1px solid #ccc; border-radius: 4px; width: 80px;">
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔥 OSHA Logger Server running locally on http://localhost:${PORT}`));