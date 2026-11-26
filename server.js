// Render.com API server for the independent cbcSchool App marketing website.
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');

const app = express();
const PORT = process.env.PORT || 3000;
const LEADS_FILE = path.join(__dirname, 'leads.json');
const ADMIN_EMAIL = process.env.LEADS_ADMIN_EMAIL || 'jonathankiranga@gmail.com';
const REPLY_TO_EMAIL = process.env.LEADS_REPLY_TO || ADMIN_EMAIL;
const ALLOWED_ORIGINS = new Set([
  'https://smarternowapps.co.ke',
  'https://www.smarternowapps.co.ke',
  'https://cbcschool-app.vercel.app'
]);
if (process.env.ALLOWED_ORIGINS) {
  process.env.ALLOWED_ORIGINS.split(',').map(value => value.trim()).filter(Boolean)
    .forEach(origin => ALLOWED_ORIGINS.add(origin));
}

let resend = null;
if (process.env.RESEND_API_KEY) {
  resend = new Resend(process.env.RESEND_API_KEY);
}

// Basic in-memory throttling. This protects the public lead endpoint without
// adding a dependency; counters reset when the Render instance restarts.
const requestCounts = new Map();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 5;

app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=()');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  } else if (origin && req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '16kb', strict: true }));

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  let record = requestCounts.get(key);
  if (!record || now - record.startedAt >= RATE_WINDOW_MS) {
    record = { startedAt: now, count: 0 };
  }
  record.count += 1;
  requestCounts.set(key, record);

  if (record.count > RATE_LIMIT) {
    const retryAfter = Math.ceil((RATE_WINDOW_MS - (now - record.startedAt)) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  next();
}

// Health check used by the marketing website to wake the Render instance.
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Static assets are deployed separately by Vercel in production.
app.use(express.static(path.join(__dirname, 'frontend'), {
  maxAge: '7d',
  etag: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  }
}));

const questionnaireHtml = `
  <h2 style="margin:28px 0 12px;color:#18233b;">Your school onboarding questionnaire</h2>
  <p>Please reply to this email and type your answers below each question. Short answers are perfectly fine. We will use your answers to prepare a practical onboarding conversation with you.</p>
  <ol style="padding-left:22px;line-height:1.8;">
    <li><strong>School location:</strong> Which town, county and area is your school in?</li>
    <li><strong>School level:</strong> Which levels do you offer (Pre-Primary, Primary, Junior School, Senior School or a combination)?</li>
    <li><strong>Learners:</strong> Approximately how many learners are currently enrolled?</li>
    <li><strong>Staff:</strong> Approximately how many teachers and other staff members will use the system?</li>
    <li><strong>Classes:</strong> Which grades/classes do you currently operate?</li>
    <li><strong>Current records:</strong> How do you currently manage learner records, attendance, assessments and school fees (paper, spreadsheets or another system)?</li>
    <li><strong>Main priorities:</strong> Which three school-management tasks would you most like to improve first?</li>
    <li><strong>Onboarding contact:</strong> Who will coordinate the setup, and what is their role and preferred phone number?</li>
    <li><strong>Preferred start:</strong> When would you like us to guide you through onboarding?</li>
  </ol>
  <p><strong>Please do not email student names, admission numbers, parent contacts, assessment records or other identifiable learner information at this stage.</strong> We only need approximate counts and general requirements.</p>
`;

app.post('/api/leads', rateLimit, async (req, res) => {
  try {
    const body = req.body || {};
    const school = typeof body.school === 'string' ? body.school.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim().replace(/\s+/g, '') : '';

    if (!school || !email || !phone) {
      return res.status(400).json({ error: 'School, email, and phone are required.' });
    }
    if (school.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        email.length > 254 || phone.length < 9 || phone.length > 20 ||
        !/^\+?[0-9()\-]+$/.test(phone)) {
      return res.status(400).json({ error: 'Please check the school name, email address and phone number.' });
    }
    if (!resend) {
      return res.status(503).json({ error: 'Email service is temporarily unavailable. Please try again later.' });
    }

    const entry = {
      school,
      email,
      phone,
      timestamp: new Date().toISOString()
    };

    // Best-effort local record. Render's local filesystem is ephemeral unless
    // a persistent disk is configured; email delivery remains the notification path.
    try {
      let leads = [];
      if (fs.existsSync(LEADS_FILE)) {
        const existing = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
        if (Array.isArray(existing)) leads = existing;
      }
      leads.push(entry);
      fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2), { mode: 0o600 });
    } catch (storageError) {
      console.error('Lead local storage failed:', storageError.message);
    }

    const safeSchool = escapeHtml(entry.school);
    const safeEmail = escapeHtml(entry.email);
    const safePhone = escapeHtml(entry.phone);
    const safeTimestamp = escapeHtml(entry.timestamp);

    const welcomeResult = await resend.emails.send({
      from: 'cbcSchool App <noreply@smarternowapps.co.ke>',
      to: entry.email,
      replyTo: REPLY_TO_EMAIL,
      subject: 'Welcome to cbcSchool App — let us understand your school',
      html: `
        <div style="font-family:Arial,sans-serif;color:#263247;line-height:1.65;max-width:680px;margin:auto;">
          <h1 style="color:#243b75;">Welcome to cbcSchool App</h1>
          <p>Dear ${safeSchool} team,</p>
          <p>Thank you for your interest in cbcSchool App. I will personally guide you through the onboarding process so that we focus on the needs and working practices of your school.</p>
          <p>To help me prepare, please <strong>reply directly to this email</strong> and complete the short questionnaire below. You do not need to open another website or create an account to answer it.</p>
          ${questionnaireHtml}
          <p>Once I receive your response, I will review it and contact you to agree on the next onboarding steps.</p>
          <p>Kind regards,<br><strong>Jonathan</strong><br>Smarternow Data Venture<br><a href="https://smarternowapps.co.ke">smarternowapps.co.ke</a></p>
        </div>
      `
    });

    if (welcomeResult.error) {
      console.error('Welcome email delivery failed:', welcomeResult.error);
      return res.status(502).json({ error: 'Your request was received, but the welcome email could not be sent. Please try again shortly.' });
    }

    // Notify the onboarding owner separately. Do not expose the prospect in CC.
    const adminResult = await resend.emails.send({
      from: 'cbcSchool App <noreply@smarternowapps.co.ke>',
      to: ADMIN_EMAIL,
      replyTo: entry.email,
      subject: `New cbcSchool App enquiry: ${entry.school}`,
      html: `
        <h2>New cbcSchool App enquiry</h2>
        <table style="border-collapse:collapse;font-family:Arial,sans-serif;">
          <tr><td style="padding:8px 16px;font-weight:bold;">School:</td><td style="padding:8px 16px;">${safeSchool}</td></tr>
          <tr><td style="padding:8px 16px;font-weight:bold;">Email:</td><td style="padding:8px 16px;">${safeEmail}</td></tr>
          <tr><td style="padding:8px 16px;font-weight:bold;">Phone:</td><td style="padding:8px 16px;">${safePhone}</td></tr>
          <tr><td style="padding:8px 16px;font-weight:bold;">Submitted:</td><td style="padding:8px 16px;">${safeTimestamp}</td></tr>
        </table>
        <p>The welcome email with the inline onboarding questionnaire has been sent to the school.</p>
      `
    });
    if (adminResult.error) console.error('Admin notification failed:', adminResult.error);

    console.log('Lead accepted and welcome email sent.');
    return res.json({
      ok: true,
      message: 'Thank you. Your welcome email and onboarding questionnaire have been sent.'
    });
  } catch (err) {
    console.error('Lead API error:', err.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`cbcSchool App marketing API running on port ${PORT}`);
});
