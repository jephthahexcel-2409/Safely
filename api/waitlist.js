// api/waitlist.js
// Count is derived directly from Google Sheets row count — no JSONBin needed.

const https = require("https");

const SHEET_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyCeg_iZV8ihEokJ1XKDqylJ0yHEdXTzQdCqSOWYeCD3rkDbCnsKbOrxSkhsk_WArn3tQ/exec";

// Read raw body from request stream
function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
    setTimeout(() => resolve(data), 5000);
  });
}

function httpsRequest(hostname, path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Request timed out")), 10000);
    try {
      const req = https.request({ hostname, path, method, headers }, (res) => {
        // Follow redirects (Google Apps Script returns 302)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          clearTimeout(timer);
          const loc = new URL(res.headers.location);
          return httpsRequest(loc.hostname, loc.pathname + loc.search, method, headers, body)
            .then(resolve).catch(reject);
        }
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          clearTimeout(timer);
          try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
        });
      });
      req.on("error", (err) => { clearTimeout(timer); reject(err); });
      if (body) req.write(body);
      req.end();
    } catch (err) { clearTimeout(timer); reject(err); }
  });
}

// GET count from Google Sheet (Apps Script returns { count: N })
async function getCount() {
  try {
    const u = new URL(SHEET_SCRIPT_URL);
    const result = await httpsRequest(
      u.hostname,
      u.pathname + u.search,
      "GET",
      {},
      null
    );
    if (result && typeof result.count !== "undefined") return Number(result.count);
    console.error("getCount unexpected response:", JSON.stringify(result));
    return 0;
  } catch (err) {
    console.error("getCount error:", err.message);
    return 0;
  }
}

// POST new entry to Google Sheet
async function sendToSheet(whatsapp) {
  try {
    const params = new URLSearchParams({
      whatsapp: whatsapp,
      joinedAt: new Date().toISOString(),
    });
    const body = params.toString();
    const u = new URL(SHEET_SCRIPT_URL);

    const result = await httpsRequest(
      u.hostname,
      u.pathname + u.search,
      "POST",
      {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
      body
    );
    console.log("Sheet POST response:", JSON.stringify(result));
    return result;
  } catch (err) {
    console.error("sendToSheet error:", err.message);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") return res.status(200).end();

  // GET — return live count straight from Google Sheet
  if (req.method === "GET") {
    const count = await getCount();
    return res.status(200).json({ count });
  }

  // POST — register a new number
  if (req.method === "POST") {
    let whatsapp = "";
    try {
      let rawBody = req.body;
      if (!rawBody || (typeof rawBody === "object" && Object.keys(rawBody).length === 0)) {
        rawBody = await readBody(req);
      }
      const parsed = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
      whatsapp = String(parsed.whatsapp || "").trim();
    } catch (err) {
      console.error("Body parse error:", err.message);
    }

    const digits = whatsapp.replace(/\D/g, "");
    if (digits.length < 7) {
      return res.status(400).json({
        success: false,
        error: "Please provide a valid WhatsApp number."
      });
    }

    // Save to sheet
    await sendToSheet(whatsapp);

    // Fetch fresh count from sheet after saving
    const newCount = await getCount();

    return res.status(200).json({
      success: true,
      message: "You are on the list! We will reach out before launch.",
      count: newCount,
    });
  }

  return res.status(405).json({ success: false, error: "Method not allowed" });
};
