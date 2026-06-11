import 'dotenv/config';
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
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
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
  secret: process.env.SESSION_SECRET || 'fallback-secret-key',
  resave: false,
  saveUninitialized: false,
  // ...
}));

// --- THE AUTOMATED ENGINE (SIMULATION MODE) ---
async function runAirQualityCheck() {
  const worksites = await prisma.worksite.findMany({
    where: { isActive: true },
    include: { company: true }
  });

  for (const site of worksites) {
    try {
      const stateLaw = await prisma.stateRegulation.findUnique({
        where: { stateCode: site.state }
      });

      const voluntaryLimit = stateLaw?.voluntaryAqi || 151;
      const mandatoryLimit = stateLaw?.mandatoryAqi || 9999; 

// 1. Fetch Real Live AQI from the US Government API
      let liveAirNowAqi = 0; 
      
      try {
        const airNowUrl = `https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json&latitude=${site.latitude}&longitude=${site.longitude}&distance=50&API_KEY=350E39ED-95D5-42DF-A55F-11AD91D38FB8`;
        const airNowResponse = await axios.get(airNowUrl);
        
        // AirNow returns an array of different pollutants. We isolate the highest AQI number.
        if (airNowResponse.data && airNowResponse.data.length > 0) {
           liveAirNowAqi = Math.max(...airNowResponse.data.map((reading: any) => reading.AQI));
           
           // THE NEW VIEWFINDER LOG:
           console.log(`✅ Success! ${site.incidentName} current AQI is: ${liveAirNowAqi}`);

        } else {
           console.log(`⚠️ AirNow returned no data for coordinates ${site.latitude}, ${site.longitude}.`);
           continue; 
        }
      } catch (apiError: any) {
        console.error(`❌ AirNow API connection failed for ${site.incidentName}:`, apiError.message);
        continue; 
      }

      // 1. Determine exact litigation status and threshold matched
      let alertLevel = "SAFE";
      let applicableThreshold = voluntaryLimit;

      if (liveAirNowAqi >= mandatoryLimit) {
        alertLevel = "MANDATORY";
        applicableThreshold = mandatoryLimit;
      } else if (liveAirNowAqi >= voluntaryLimit) {
        alertLevel = "VOLUNTARY";
        applicableThreshold = voluntaryLimit;
      }

      // --- THE ANTI-SPAM CHECK (EDGE TRIGGERING) ---
      // Look up the most recent log for this exact worksite before we save the new one
      const lastLog = await prisma.hourlyAirLog.findFirst({
        where: { worksiteId: site.id },
        orderBy: { timestamp: 'desc' } // Gets the most recent entry
      });

      // 2. PERMANENT RECORDARY INSULATION: Save every check to database
      await prisma.hourlyAirLog.create({
        data: {
          worksiteId: site.id,
          aqi: liveAirNowAqi,
          status: alertLevel,
          lawThreshold: applicableThreshold
        }
      });

      // --- ESCALATION LOGIC ---
      // We only want to send a text if the alert level is dangerous AND it is a newly escalated status
      const isNewEscalation = !lastLog || lastLog.status !== alertLevel;

      // 3. Fire notification alerts ONLY if a threshold is broken AND it just changed
    if (alertLevel !== "SAFE" && isNewEscalation) {
      try {
        // Set up plain-English messaging based on the severity level
        let smsSubject = "SMOKE ALERT";
        let smsText = `AQI at ${site.incidentName} is ${liveAirNowAqi}. Smoke is getting heavy. N95 masks are available for anyone who wants one—wearing them is VOLUNTARY right now. Grab masks for interested crew and sign off here: https://alert-air-ezio.onrender.com/signoff/${site.id}`;

        if (alertLevel === "MANDATORY") {
          smsSubject = "SAFETY MANDATE";
          smsText = `CRITICAL: AQI at ${site.incidentName} hit ${liveAirNowAqi}. Air quality is hazardous. N95 masks are now MANDATORY for all personnel on site. Distribute masks immediately and log compliance here: https://alert-air-ezio.onrender.com/signoff/${site.id}`;
        }

        // SMS to Crew Lead
        await transporter.sendMail({
          from: '"Alert Air Compliance" <compliance.alertair@gmail.com>',
          to: `${site.foremanPhone}${site.carrier}`,
          subject: smsSubject,
          text: smsText
        });

        // SMS to Admin
        if (site.company.adminPhone && site.company.adminCarrier) {
          await transporter.sendMail({
            from: '"Alert Air Compliance" <compliance.alertair@gmail.com>',
            to: `${site.company.adminPhone}${site.company.adminCarrier}`,
            subject: 'CREW ALERT DISPATCHED',
            text: `ADMIN ALERT: ${smsSubject} sent to crew at ${site.incidentName} (${liveAirNowAqi} AQI). Awaiting foreman sign-off.`
          });
        }
        console.log(`📱 Alerts cleanly dispatched for ${site.incidentName} [Status: ${alertLevel}]`);
      } catch (emailError) {
        console.error(`❌ Failed to send gateway SMS:`, emailError);
      }
    } else if (alertLevel !== "SAFE" && !isNewEscalation) {
      // Silently log that we suppressed a duplicate text
      console.log(`🔇 Suppressed duplicate text for ${site.incidentName}. Status remains ${alertLevel}.`);
    }
  } catch (error) {
    console.error(`❌ Failed to process site ${site.incidentName}:`, error);
  }
}
}

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

            <div style="display: flex; align-items: flex-start; gap: 0.5rem; text-align: left;">
              <input 
                type="checkbox" 
                id="tos-checkbox" 
                name="tosAccepted" 
                value="true" 
                required 
                style="margin-top: 3px; cursor: pointer;" 
                onchange="toggleSubmitButton()"
              >
              <label for="tos-checkbox" style="font-size: 12px; color: #6c757d; line-height: 1.4; cursor: pointer; user-select: none;">
                I represent the corporate subscriber and explicitly agree to Alert Air's 
                <a href="/terms" target="_blank" style="color: #0275d8; text-decoration: none; font-weight: bold;">Terms of Service</a> and 
                <a href="/privacy" target="_blank" style="color: #0275d8; text-decoration: none; font-weight: bold;">Privacy Policy</a>, 
                including Third-Party Data Accuracy Disclaimers.
              </label>
            </div>

            <button 
              type="submit" 
              id="signup-btn" 
              disabled 
              style="background: #a0a0a0; color: white; border: none; padding: 12px; border-radius: 6px; cursor: not-allowed; font-weight: bold; font-size: 1rem; transition: background 0.2s ease;"
            >
              Create Account
            </button>
          </form>
          <p style="margin-top: 1.5rem; font-size: 14px; color: #666;">Already registered? <a href="/login" style="color: #0275d8; text-decoration: none; font-weight: bold;">Login here</a></p>
        </div>

        <script>
          function toggleSubmitButton() {
            const checkbox = document.getElementById('tos-checkbox');
            const submitBtn = document.getElementById('signup-btn');
            if (checkbox.checked) {
              submitBtn.disabled = false;
              submitBtn.style.background = '#5cb85c';
              submitBtn.style.cursor = 'pointer';
            } else {
              submitBtn.disabled = true;
              submitBtn.style.background = '#a0a0a0';
              submitBtn.style.cursor = 'not-allowed';
            }
          }
        </script>
      </body>
    </html>
  `);
});

// ⚖️ LEGAL TERMS OF SERVICE ROUTE
app.get('/terms', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Terms of Service - Alert Air</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; line-height: 1.6; color: #334155; background: #f8fafc; padding: 3rem 1rem; margin: 0; display: flex; justify-content: center;">
        
        <div style="background: white; padding: 3rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); max-width: 650px; width: 100%; box-sizing: border-box;">
          
          <h1 style="color: #0f172a; font-size: 28px; margin-top: 0; margin-bottom: 0.5rem; letter-spacing: -0.5px;">Terms of Service</h1>
          <p style="color: #64748b; font-size: 14px; margin-top: 0; margin-bottom: 2rem;">Last Updated: June 2026</p>
          
          <h2 style="color: #1e3a8a; font-size: 18px; margin-top: 1.5rem; margin-bottom: 0.5rem;">1. Nature of the Service</h2>
          <p style="margin: 0 0 1.5rem 0; font-size: 15px;">Alert Air provides data aggregation, tracking, and compliance record-keeping software. The platform is designed to assist corporate subscribers in monitoring air quality metrics at designated worksites. Alert Air does not provide professional occupational safety, medical, or legal counsel.</p>

          <h2 style="color: #1e3a8a; font-size: 18px; margin-top: 1.5rem; margin-bottom: 0.5rem;">2. Reliance on Third-Party Environmental Data</h2>
          <p style="margin: 0 0 1.5rem 0; font-size: 15px;">Subscriber acknowledges that Alert Air aggregates real-time air quality index (AQI) readings from public, third-party environmental monitoring feeds (including but not limited to the EPA and regional regulatory agencies). Alert Air makes no warranties, express or implied, regarding the accuracy, completeness, calibration, or real-time delivery performance of these external feeds.</p>

          <h2 style="color: #1e3a8a; font-size: 18px; margin-top: 1.5rem; margin-bottom: 0.5rem;">3. Ultimate Statutory Responsibility</h2>
          <p style="margin: 0 0 1.5rem 0; font-size: 15px;">The subscriber retains sole, non-delegable statutory responsibility for evaluating physical hazards, ensuring on-site workplace safety, implementing mandatory labor protections, and fully complying with all state, federal, or OSHA standards. Missed, delayed, or unreceived platform notifications shall not alleviate subscriber of this legal obligation.</p>

          <h2 style="color: #1e3a8a; font-size: 18px; margin-top: 1.5rem; margin-bottom: 0.5rem;">4. Limitation of Liability</h2>
          <p style="margin: 0 0 1.5rem 0; font-size: 15px; font-weight: 500;">To the maximum extent permitted by applicable law, in no event shall Alert Air be liable for any consequential, incidental, indirect, special, or punitive damages whatsoever—including but not limited to regulatory fines, OSHA citations, project delays, or toxic exposure personal injury claims—arising out of the use or inability to use the platform. Alert Air's total aggregate liability under this agreement shall be strictly capped at the amount actually paid by the subscriber to Alert Air during the preceding three (3) months.</p>

          <h2 style="color: #1e3a8a; font-size: 18px; margin-top: 1.5rem; margin-bottom: 0.5rem;">5. Indemnification</h2>
          <p style="margin: 0 0 1.5rem 0; font-size: 15px;">Subscriber agrees to indemnify, defend, and hold harmless Alert Air and its developers from and against any and all claims, liabilities, losses, administrative penalties, civil fines, or legal expenses (including attorneys' fees) resulting from or arising out of subscriber's on-site operations, field employment practices, or failure to implement proper safety protocols during recorded air quality threshold excursions.</p>

          <div style="margin-top: 3rem; border-top: 1px solid #e2e8f0; padding-top: 1.5rem; text-align: center;">
            <button onclick="window.close();" style="background: #0275d8; color: white; border: none; padding: 10px 20px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 14px;">Close Window</button>
          </div>

        </div>
      </body>
    </html>
  `);
});

// 🔒 B2B PRIVACY POLICY ROUTE
// 🔒 FIXED PRIVACY POLICY ROUTE
app.get('/privacy', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Privacy Policy - Alert Air</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; line-height: 1.6; color: #334155; background: #f8fafc; padding: 3rem 1rem; margin: 0; display: flex; justify-content: center;">
        
        <div style="background: white; padding: 3rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); max-width: 650px; width: 100%; box-sizing: border-box;">
          
          <h1 style="color: #0f172a; font-size: 28px; margin-top: 0; margin-bottom: 0.5rem; letter-spacing: -0.5px;">Privacy Policy</h1>
          <p style="color: #64748b; font-size: 14px; margin-top: 0; margin-bottom: 2rem;">Last Updated: June 2026</p>
          
          <h2 style="color: #1e3a8a; font-size: 18px; margin-top: 1.5rem; margin-bottom: 0.5rem;">1. Information We Collect</h2>
          <p style="margin: 0 0 1.5rem 0; font-size: 15px;">Alert Air collects necessary corporate telemetry to execute automated compliance operations. This includes corporate registration contacts, administrative phone metrics, physical worksite geographical coordinates (latitude and longitude parameters), and on-site foreman routing data required to transmit real-time hazard notifications.</p>

          <h2 style="color: #1e3a8a; font-size: 18px; margin-top: 1.5rem; margin-bottom: 0.5rem;">2. Utilization of Telemetry Data</h2>
          <p style="margin: 0 0 1.5rem 0; font-size: 15px;">Data processed by the system is leveraged exclusively to run statutory air quality evaluations, maintain the subscriber's historical defense ledger, and dispatch automated SMS notifications when local AQI measurements exceed legislative action thresholds.</p>

          <h2 style="color: #1e3a8a; font-size: 18px; margin-top: 1.5rem; margin-bottom: 0.5rem;">3. Data Retention Framework</h2>
          <p style="margin: 0 0 1.5rem 0; font-size: 15px;">To protect subscribers during potential regulatory investigations or toxic exposure civil claims, Alert Air maintains hourly monitoring logs and crew verification timestamps inside a secure, encrypted cloud database environment. Historical ledger records are preserved indefinitely unless formal deletion is explicitly requested by the corporate subscriber.</p>

          <h2 style="color: #1e3a8a; font-size: 18px; margin-top: 1.5rem; margin-bottom: 0.5rem;">4. Third-Party Disclosures</h2>
          <p style="margin: 0 0 1.5rem 0; font-size: 15px;">Alert Air does not sell, lease, or distribute operational telemetry to third-party brokers or advertisers. Data fields are shared strictly with verified utility gateways (such as regional telecommunication carriers and SMS aggregators) solely to execute mandatory text alerts to field personnel.</p>

          <div style="margin-top: 3rem; border-top: 1px solid #e2e8f0; padding-top: 1.5rem; text-align: center;">
            <button onclick="window.close();" style="background: #0275d8; color: white; border: none; padding: 10px 20px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 14px;">Close Window</button>
          </div>

        </div>
      </body>
    </html>
  `);
});

app.post('/signup', async (req, res) => {
  const { companyName, email, password, adminPhone, adminCarrier, tosAccepted } = req.body;

  // 1. Strict Legal Guardrail: Enforce checkbox verification server-side
  if (tosAccepted !== 'true') {
    return res.send("<h2 style='text-align:center; margin-top:2rem; font-family:sans-serif;'>❌ You must review and accept the Terms of Service to register. <a href='/signup'>Go back</a></h2>");
  }

  // 2. Check if the email is already taken
  const existingCompany = await prisma.company.findUnique({ where: { contact: email } });
  if (existingCompany) {
    return res.send("<h2 style='text-align:center; margin-top:2rem; font-family:sans-serif;'>❌ Email already in use. <a href='/login'>Login</a></h2>");
  }

  // 3. Cryptographically hash the password (salt 10 rounds)
  const hashedPassword = await bcrypt.hash(password, 10);

  // 4. Save the new company along with the immutable legal audit record properties
  const newCompany = await prisma.company.create({
    data: {
      name: companyName,
      contact: email,
      password: hashedPassword,
      adminPhone: adminPhone,
      adminCarrier: adminCarrier,
      
      // Commit the explicit legal sign-off signature details
      tosAccepted: true,
      tosAcceptedAt: new Date()
    }
  });

  // 5. Log them in instantly and send them to the dashboard
  req.session.companyId = newCompany.id;
  res.redirect('/admin/litigation-records');
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

// ⏰ SECURE BACKGROUND CRON TRIGGER ENDPOINT
app.get('/api/cron-trigger', async (req, res) => {
  const { secret } = req.query;

  // Security firewall to prevent unauthorized execution
  if (secret !== 'alert_air_secure_heartbeat_2026') {
    console.warn('⚠️ Unauthorized cron trigger attempt detected.');
    return res.status(401).send('Unauthorized trigger attempt.');
  }

  console.log('⚡ External cron heartbeat validated. Executing air quality sync...');
  
  try {
    // Triggers your existing automated tracking loop
    await runAirQualityCheck(); 
    return res.status(200).send('Compliance data synchronization complete.');
  } catch (error) {
    console.error('❌ Automated compliance cron execution failed:', error);
    return res.status(500).send('Internal compliance engine error.');
  }
});

// --- TOGGLE WORKSITE STATUS (DEMOBILIZE) ---
app.post('/api/worksite/:id/toggle', async (req, res) => {
  if (!req.session.companyId) return res.redirect('/login');

  try {
    const worksiteId = req.params.id;
    
    // Find the current worksite and verify ownership
    const worksite = await prisma.worksite.findUnique({
      where: { id: worksiteId }
    });

    if (!worksite || worksite.companyId !== req.session.companyId) {
      return res.status(403).send("Unauthorized access.");
    }

    // Toggle the active status
    await prisma.worksite.update({
      where: { id: worksiteId },
      data: { isActive: !worksite.isActive } 
    });

    res.redirect('/admin');
    
  } catch (error) {
    console.error("Error toggling worksite status:", error);
    res.status(500).send("<h2 style='color: red; text-align: center;'>Failed to update crew status.</h2>");
  }
});

// --- PERMANENTLY NUKE WORKSITE AND RELATED LOGS ---
app.post('/api/worksite/:id/delete', async (req, res) => {
  if (!req.session.companyId) return res.redirect('/login');

  try {
    const worksiteId = req.params.id;
    
    const worksite = await prisma.worksite.findUnique({
      where: { id: worksiteId }
    });

    if (!worksite || worksite.companyId !== req.session.companyId) {
      return res.status(403).send("Unauthorized access.");
    }

    // 1. Clear out all dependent child tables to prevent foreign-key crashes
    if (prisma.hourlyAirLog) {
      await prisma.hourlyAirLog.deleteMany({ where: { worksiteId } });
    }
    if (prisma.complianceSignoff) {
      await prisma.complianceSignoff.deleteMany({ where: { worksiteId } });
    }
    // Handles the early text-signature table fallback
    if (prisma.signOff) {
      await prisma.signOff.deleteMany({ where: { siteId: worksiteId } });
    }

    // 2. Erase the main worksite record
    await prisma.worksite.delete({
      where: { id: worksiteId }
    });

    res.redirect('/admin');
    
  } catch (error) {
    console.error("Error purging worksite:", error);
    res.status(500).send("<h2 style='color: red; text-align: center;'>Failed to delete crew record.</h2>");
  }
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
        <h2 class="text-4xl font-black mb-6">Simple, No-Nonsense Pricing</h2>
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
          from: '"Alert Air Compliance" <compliance.alertair@gmail.com>',
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

// 
// 3. BUILD THE TABLE ROWS
  const rows = worksites.map(site => {
    const statusBadge = site.isActive 
      ? `<span style="background: #d4edda; color: #155724; padding: 4px 8px; border-radius: 4px; font-weight: bold;">On-Site</span>`
      : `<span style="background: #f8d7da; color: #721c24; padding: 4px 8px; border-radius: 4px; font-weight: bold;">Demobilized</span>`;

    const toggleAction = site.isActive ? 'Demobilize Crew' : 'Remobilize Crew';
    const buttonColor = site.isActive ? '#f0ad4e' : '#5cb85c';

    // Show a delete button ONLY if the crew has already been demobilized
    const deleteButton = !site.isActive 
      ? `
        <form action="/api/worksite/${site.id}/delete" method="POST" style="margin: 8px 0 0 0;" onsubmit="return confirm('Are you sure you want to permanently delete this crew and all its logs? This cannot be undone.');">
          <button type="submit" style="background: #d9534f; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; width: 100%; font-size: 13px;">❌ Delete Record</button>
        </form>
      `
      : '';

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

        <td style="padding: 16px; vertical-align: top;">
          <form action="/api/worksite/${site.id}/toggle" method="POST" style="margin: 0;">
            <button type="submit" style="background: ${buttonColor}; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; width: 100%;">${toggleAction}</button>
          </form>
          ${deleteButton}
        </td>
        <td style="padding: 15px 16px; vertical-align: top;">
          <a href="/admin/worksite/${site.id}/logs" style="display: inline-block; background: #3b82f6; color: white; padding: 8px 14px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 13px; box-shadow: 0 2px 4px rgba(59,130,246,0.3);">🔍 View Log History</a>
        </td>
      </tr>
    `;
  }).join('');

res.send(`
    <html>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f7f6; padding: 3rem 1rem; color: #333; margin: 0; display: flex; justify-content: center;">
        
        <div style="max-width: 1000px; width: 100%; display: flex; flex-direction: column; gap: 2rem;">
            
            <div style="background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.05);">
              <h2 style="margin-top: 0; color: #2c3e50; font-weight: 800;"> Deploy New Crew</h2>
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

                  <button type="submit" style="background: #5cb85c; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: bold;">Deploy New Crew</button>
              </form>
            </div>

           <div style="border-bottom: 2px solid #eee; padding-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
                <div>
                  <h1 style="color: #0275d8; font-size: 26px; margin: 0; letter-spacing: -0.5px; font-weight: 800;">Alert Air Wildfire Compliance</h1>
                  <p style="color: #6c757d; margin-top: 6px; margin-bottom: 0; font-size: 15px; font-weight: 500;">Dashboard</p>
                </div>
                
                <a href="/admin/litigation-records" style="display: inline-block; background: #1e293b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 15px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); border: 1px solid #0f172a;">
                  Incident Archive
                </a>
              </div>

            ${worksites.length === 0 ?
              `<a href="https://buy.stripe.com/fZu7sMgx34i7bDo4DHgrS00" target="_blank" style="display: inline-block; background: #6772e5; color: white; padding: 10px 15px; text-decoration: none; border-radius: 5px; font-weight: bold; max-width: 200px; text-align: center;">💳 Start 14-Day Free Trial</a>` 
            : ``}

            <div style="background: #e9ecef; padding: 15px; border-radius: 8px; font-size: 14px; color: #495057; border-left: 4px solid #6c757d; line-height: 1.5;">
              <strong>Billing & Demobilization:</strong> Billing is flat-rate per active monitor deployment. To demobilize a crew and instantly stop billing for that unit, please email <a href="mailto:compliance.alertair@gmail.com" style="color: #0275d8; font-weight: bold; text-decoration: none;">compliance.alertair@gmail.com</a> with the incident name.
            </div>
              
            <div style="overflow-x: auto; width: 100%; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.02); border: 1px solid #dee2e6;">
              <table style="width: 100%; min-width: 800px; border-collapse: collapse; text-align: left;">
                <thead>
                  <tr style="background: #f8f9fa; border-bottom: 2px solid #dee2e6; color: #495057; font-size: 13px; font-weight: 800;">
                    <th style="padding: 16px;">INCIDENT NAME</th>
                    <th style="padding: 16px;">STATUS</th>
                    <th style="padding: 16px;">CREW LEAD DETAILS</th>
                    <th style="padding: 16px;">ACTIONS</th>
                    <th style="padding: 16px;">AUDIT Record</th>
                  </tr>
                </thead>
                <tbody style="font-size: 14px; color: #333;">
                  ${rows}
                </tbody>
              </table>
            </div>
            
        </div>
      </body>
    </html>
  `);

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
});

// --- THE IMMUTABLE AUDIT LEDGER ---
app.get('/admin/audit', async (req, res) => {
  // SECURITY BOUNCER: Kick them to login if they aren't authenticated
  if (!req.session.companyId) return res.redirect('/login');

  try {
    // 1. Fetch worksites specifically owned by this logged-in company
    const myWorksites = await prisma.worksite.findMany({
      where: { companyId: req.session.companyId },
      select: { id: true }
    });
    
    const myWorksiteIds = myWorksites.map(ws => ws.id);

    // 2. Fetch only the sign-offs belonging to those specific worksites
    const logs = await prisma.complianceSignoff.findMany({
      where: { worksiteId: { in: myWorksiteIds } },
      orderBy: { createdAt: 'desc' } // Newest signatures first
    });

    // 3. Build the secure paper trail table by manually looking up the worksite
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

    // 4. Render the Dashboard
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

// --- DEEP DIVE AUDIT LEDGER PAGE ---
app.get('/admin/worksite/:id/logs', async (req, res) => {
  // 1. Security Check
  if (!req.session.companyId) {
    return res.redirect('/login');
  }

  try {
    // 2. Fetch the specific worksite and all of its compliance sign-offs
    const worksite = await prisma.worksite.findUnique({
      where: { id: req.params.id },
      include: { 
        signOffs: { orderBy: { timestamp: 'desc' } } 
      }
    });

    if (!worksite) {
      return res.status(404).send("Worksite not found.");
    }

// 3. Build the individual HTML cards for each log
    const logCards = worksite.signOffs.map(log => `
      <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px; margin-bottom: 12px;">
          <strong style="color: #10b981; font-size: 18px;">✅ Verified Compliant</strong>
          <span style="color: #64748b; font-size: 14px; font-weight: 500;">${new Date(log.timestamp).toLocaleString()}</span>
        </div>
        <div style="color: #334155; font-size: 15px; line-height: 1.6; display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <div><strong>Signatory:</strong> ${log.signature || worksite.crewLeadName}</div>
          <div><strong>Phone:</strong> ${worksite.foremanPhone}</div>
          <div><strong>AQI at Time of Alert:</strong> <span style="color: #eab308; font-weight: bold;">Threshold Exceeded</span></div>
          <div><strong>Coordinates:</strong> ${worksite.latitude}, ${worksite.longitude}</div>
          <div style="grid-column: 1 / -1; margin-top: 8px; background: #f8fafc; padding: 10px; border-radius: 6px; border-left: 3px solid #3b82f6;">
            <strong>Mandate Enforced:</strong> N95 Respirators Distributed & Mandatory Work/Rest Cycles Initiated.
          </div>
        </div>
      </div>
    `).join('');

    // 4. Send the Full Page HTML
    res.send(`
      <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f7f6; padding: 3rem; color: #333; margin: 0;">
          <div style="max-width: 800px; margin: 0 auto;">
            <a href="/admin" style="display: inline-block; text-decoration: none; color: #3b82f6; font-weight: bold; margin-bottom: 20px;">&larr; Back to Command Center</a>
            
            <div style="background: white; padding: 3rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.05);">
              <h1 style="color: #0f172a; margin-top: 0; font-size: 28px;">Immutable Audit Ledger</h1>
              <p style="color: #64748b; font-size: 16px; margin-top: 5px;"><strong>Incident:</strong> ${worksite.incidentName} | <strong>Status:</strong> ${worksite.isActive ? '🟢 Active' : '⚪ Demobilized'}</p>
              
              <hr style="border: none; border-top: 2px solid #f1f5f9; margin: 30px 0;">
              
              <h3 style="color: #475569; margin-bottom: 20px;">Timestamped Sign-Offs</h3>
              ${logCards.length > 0 ? logCards : '<p style="color: #94a3b8; font-style: italic; background: #f8fafc; padding: 20px; border-radius: 8px; text-align: center;">No compliance signatures recorded for this unit yet.</p>'}
            </div>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Error loading logs page:", error);
    res.status(500).send("Error loading audit ledger.");
  }
});// --- TABBED LITIGATION REPOSITORY ---
app.get('/admin/litigation-records', async (req, res) => {
  if (!req.session.companyId) return res.redirect('/login');

  try {
    // Fetch all hourly air logs for this company's active/past worksites
    const worksites = await prisma.worksite.findMany({
      where: { companyId: req.session.companyId },
      include: {
        hourlyLogs: { orderBy: { timestamp: 'desc' } }
      }
    });

    // Flatten logs down into categorical arrays
    const allLogs = worksites.flatMap(site => 
      site.hourlyLogs.map(log => ({ ...log, incidentName: site.incidentName, state: site.state }))
    ).sort((a,b) => b.timestamp.getTime() - a.timestamp.getTime());

    const dynamicExceedingRows = allLogs
      .filter(l => l.status !== 'SAFE')
      .map(l => `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 12px 16px;">${new Date(l.timestamp).toLocaleString()}</td>
          <td style="padding: 12px 16px;"><strong>${l.incidentName} (${l.state})</strong></td>
          <td style="padding: 12px 16px; color: #dc2626; font-weight: bold;">${l.aqi} AQI</td>
          <td style="padding: 12px 16px;"><span style="background: #fef2f2; color: #991b1b; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">${l.status} EXCEEDED</span></td>
          <td style="padding: 12px 16px; color: #64748b;">Threshold: ${l.lawThreshold} AQI</td>
        </tr>
      `).join('');

    const dynamicSafeRows = allLogs
      .filter(l => l.status === 'SAFE')
      .map(l => `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 12px 16px;">${new Date(l.timestamp).toLocaleString()}</td>
          <td style="padding: 12px 16px;"><strong>${l.incidentName} (${l.state})</strong></td>
          <td style="padding: 12px 16px; color: #16a34a; font-weight: bold;">${l.aqi} AQI</td>
          <td style="padding: 12px 16px;"><span style="background: #f0fdf4; color: #166534; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">DUTY VERIFIED</span></td>
          <td style="padding: 12px 16px; color: #64748b;">Below Limit (${l.lawThreshold})</td>
        </tr>
      `).join('');

    res.send(`
      <html>
        <head>
          <title>Litigation-Grade Audit Logs</title>
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-slate-50 p-8 font-sans text-slate-800">
<div class="max-w-5xl mx-auto">
            <div class="flex justify-between items-center mb-6">
              <div>
                <h1 class="text-3xl font-black text-slate-900">Audit Records</h1>
                <p class="text-slate-500 mt-1">Immutable record of statutory duty-of-care verification checks.</p>
              </div>
              <a href="/admin" class="bg-slate-800 text-white font-bold px-4 py-2 rounded-lg hover:bg-slate-700 transition">&larr; Back to Dashboard</a>
            </div>

            <div class="mb-8 bg-blue-50 border border-blue-200 rounded-xl p-5 flex justify-between items-center shadow-sm">
              <div class="flex items-center gap-3">
                <span class="text-2xl">📊</span>
                <div>
                  <h4 class="font-bold text-slate-900 text-sm">Export Regulatory Record</h4>
                  <p class="text-xs text-slate-600 mt-0.5">Generate a time-stamped, Excel-compatible CSV audit record for state or federal labor inspectors.</p>
                </div>
              </div>
              <a href="/admin/archive/export" class="bg-blue-600 text-white font-bold px-5 py-2.5 rounded-lg hover:bg-blue-700 transition shadow-sm whitespace-nowrap text-sm flex items-center gap-2">
                📥 Export Audit Record (.CSV)
              </a>
            </div>

            <div class="flex border-b border-slate-200 mb-6 gap-2">
              <button onclick="switchTab('exceeding')" id="tab-exceeding" class="py-3 px-6 font-bold text-sm border-b-2 border-blue-600 text-blue-600 outline-none transition">
                ⚠️ Exceeded Thresholds (${allLogs.filter(l => l.status !== 'SAFE').length})
              </button>
              <button onclick="switchTab('safe')" id="tab-safe" class="py-3 px-6 font-bold text-sm border-b-2 border-transparent text-slate-500 hover:text-slate-800 outline-none transition">
                ✅ Verified Safe Checks (${allLogs.filter(l => l.status === 'SAFE').length})
              </button>
            </div>

            <div id="panel-exceeding" class="bg-white rounded-xl shadow-md overflow-hidden border border-slate-200">
              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="bg-slate-100 text-slate-600 text-xs font-bold uppercase tracking-wider border-b border-slate-200">
                    <th class="p-4">Timestamp</th><th class="p-4">Incident</th><th class="p-4">Recorded AQI</th><th class="p-4">Status</th><th class="p-4">Statutory Limit</th>
                  </tr>
                </thead>
                <tbody>
                  ${dynamicExceedingRows || '<tr><td colspan="5" class="p-8 text-center text-slate-400 italic">No records available.</td></tr>'}
                </tbody>
              </table>
            </div>

            <div id="panel-safe" class="bg-white rounded-xl shadow-md overflow-hidden border border-slate-200 hidden">
              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="bg-slate-100 text-slate-600 text-xs font-bold uppercase tracking-wider border-b border-slate-200">
                    <th class="p-4">Timestamp</th><th class="p-4">Incident</th><th class="p-4">Recorded AQI</th><th class="p-4">Status</th><th class="p-4">Statutory Limit</th>
                  </tr>
                </thead>
                <tbody>
                  ${dynamicSafeRows || '<tr><td colspan="5" class="p-8 text-center text-slate-400 italic">No historical safe pings registered yet.</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>

          <script>
            function switchTab(target) {
              const tabExceeding = document.getElementById('tab-exceeding');
              const tabSafe = document.getElementById('tab-safe');
              const panelExceeding = document.getElementById('panel-exceeding');
              const panelSafe = document.getElementById('panel-safe');

              if(target === 'exceeding') {
                tabExceeding.className = "py-3 px-6 font-bold text-sm border-b-2 border-blue-600 text-blue-600 outline-none transition";
                tabSafe.className = "py-3 px-6 font-bold text-sm border-b-2 border-transparent text-slate-500 hover:text-slate-800 outline-none transition";
                panelExceeding.classList.remove('hidden');
                panelSafe.classList.add('hidden');
              } else {
                tabSafe.className = "py-3 px-6 font-bold text-sm border-b-2 border-blue-600 text-blue-600 outline-none transition";
                tabExceeding.className = "py-3 px-6 font-bold text-sm border-b-2 border-transparent text-slate-500 hover:text-slate-800 outline-none transition";
                panelSafe.classList.remove('hidden');
                panelExceeding.classList.add('hidden');
              }
            }
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Litigation Ledger Error:", error);
    res.status(500).send("Failed to build audit records.");
  }
});

const PORT = process.env.PORT || 3000;
// 📊 LITIGATION-GRADE AUDIT EXPORT: Generates immutable CSV for OSHA inspectors
app.get('/admin/archive/export', async (req: any, res: any) => {
  try {
    // 1. Fetch historical records including the correct 'worksite' relation
    const logs = await prisma.hourlyAirLog.findMany({
      include: {
        worksite: true,
      },
      orderBy: {
        timestamp: 'desc',
      },
    });

    // 2. Set HTTP headers to force file download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=alert_air_compliance_report.csv');

    // 3. Define headers
    let csvContent = 'Timestamp,Worksite Name,State,Recorded AQI,Status\n';

    // 4. Iterate through rows using confirmed schema properties
    for (const log of logs) {
      const timestamp = log.timestamp ? log.timestamp.toISOString().replace(/T/, ' ').replace(/\..+/, '') : 'N/A';
      const siteName = log.worksite?.incidentName ? log.worksite.incidentName.replace(/,/g, ' ') : 'Unknown Site';
      const state = log.worksite?.state || 'N/A';
      const aqiDisplay = log.aqi ?? 'N/A';

      // Check the raw numeric type directly to satisfy the compiler
      const severity = typeof log.aqi === 'number'
        ? (log.aqi >= 101 ? 'MANDATORY' : log.aqi >= 69 ? 'VOLUNTARY' : 'SAFE')
        : 'UNKNOWN';
      
      csvContent += `${timestamp},${siteName},${state},${aqiDisplay},${severity}\n`;
    }

    // 5. Stream download
    return res.status(200).send(csvContent);

  } catch (error) {
    console.error('❌ Failed to construct compliance CSV export:', error);
    return res.status(500).send('Database execution failed during audit export generation.');
  }
});

app.listen(PORT, () => console.log(`🔥 Alert Air Server running on port ${PORT}`));