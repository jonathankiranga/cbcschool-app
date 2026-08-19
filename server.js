// Render.com static site server
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');
const app = express();
const PORT = process.env.PORT || 3000;

const LEADS_FILE = path.join(__dirname, 'leads.json');

// Resend client — uses HTTPS (port 443), works on Render's free tier
// SMTP is blocked by Render; HTTP-based email APIs are the only option
let resend = null;
if (process.env.RESEND_API_KEY) {
  resend = new Resend(process.env.RESEND_API_KEY);
}

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=()');
  next();
});

// CORS — allow the Vercel frontend to call this Render API
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json());

// Cache static assets (frontend folder — served by Vercel in production)
app.use(express.static(path.join(__dirname, 'frontend'), {
  maxAge: '7d',
  etag: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  }
}));

// ─── API: Collect CTA leads ────────────────────────────────────────
app.post('/api/leads', async (req, res) => {
  try {
    const { school, email, phone } = req.body;
    if (!school || !email || !phone) {
      return res.status(400).json({ error: 'School, email, and phone are required' });
    }

    const cleaned = phone.trim().replace(/\s+/g, '');
    const entry = {
      school: school.trim(),
      email: email.trim(),
      phone: cleaned,
      timestamp: new Date().toISOString()
    };

    // Save to file (best-effort — Render filesystem is ephemeral)
    try {
      let leads = [];
      if (fs.existsSync(LEADS_FILE)) {
        leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
      }
      leads.push(entry);
      fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
    } catch { /* file save failed — continue with email */ }

    console.log(`New lead: ${entry.school} (${entry.email}, ${entry.phone})`);

    // Send email via Resend (HTTP API — works on Render, SMTP is blocked)
    if (resend) {
      const mailOptions = {
        from: 'cbcSchool App <onboarding@resend.dev>',  // use your verified domain once set up
        to: 'jonathankiranga@gmail.com',
        subject: `New CTA Lead — ${entry.school}`,
        html: `
          <h2>New cbcSchool App Registration</h2>
          <table style="border-collapse:collapse;font-family:Arial,sans-serif;">
            <tr><td style="padding:8px 16px;font-weight:bold;">School:</td><td style="padding:8px 16px;">${entry.school}</td></tr>
            <tr><td style="padding:8px 16px;font-weight:bold;">Email:</td><td style="padding:8px 16px;">${entry.email}</td></tr>
            <tr><td style="padding:8px 16px;font-weight:bold;">Phone:</td><td style="padding:8px 16px;">${entry.phone}</td></tr>
            <tr><td style="padding:8px 16px;font-weight:bold;">Submitted:</td><td style="padding:8px 16px;">${entry.timestamp}</td></tr>
          </table>
        `
      };
      // CC the visitor who submitted the form
      mailOptions.cc = entry.email;
      const { error: sendError } = await resend.emails.send(mailOptions);
      if (sendError) {
        console.error('Resend error:', sendError);
      } else {
        console.log(`Email sent to jonathankiranga@gmail.com, CC ${entry.email}`);
      }
    } else {
      console.log('RESEND_API_KEY not configured — skipping email');
    }

    res.json({ ok: true, message: 'Request received. We will contact you shortly.' });
  } catch (err) {
    console.error('Lead API error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`cbcSchool App website running on port ${PORT}`);
});
