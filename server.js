// Render.com static site server
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const app = express();
const PORT = process.env.PORT || 3000;

const LEADS_FILE = path.join(__dirname, 'leads.json');

// Email transporter (Gmail SMTP via App Password)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=()');
  next();
});

app.use(express.json());

// Cache static assets
app.use(express.static(path.join(__dirname), {
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

  // Save to file
  let leads = [];
  try {
    if (fs.existsSync(LEADS_FILE)) {
      leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
    }
  } catch { /* start fresh if file is corrupt */ }

  leads.push(entry);
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));

  console.log(`New lead: ${entry.school} (${entry.email}, ${entry.phone})`);

  // Send email
  try {
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      await transporter.sendMail({
        from: `"cbcSchool App" <${process.env.SMTP_USER}>`,
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
      });
      console.log(`Email sent to jonathankiranga@gmail.com`);
    } else {
      console.log('SMTP not configured — skipping email');
    }
  } catch (err) {
    console.error('Email send failed:', err.message);
  }

  res.json({ ok: true, message: 'Request received. We will contact you shortly.' });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`cbcSchool App website running on port ${PORT}`);
});
