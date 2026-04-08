// api/waitlist.js

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

// Follows up to 5 redirects automatically
function httpsGet(urlString, redirectCount) {
  redirectCount = redirectCount || 0;
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error("Too many redirects"));
    const url = new URL(urlString);
    const timer = setTimeout(() => reject(new Error("GET timed out")), 10000);
    https.get(url.href, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timer);
        res.resume(); // drain the response
        return httpsGet(res.headers.location, redirectCount + 1).then(resolve).catch(reject);
      }
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
      });
      res.on("error", (err) => { clearTimeout(timer); reject(err); });
    }).on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

// POST with redirect following
function httpsPost(urlString, body, redirectCount) {
  redirectCount = redirectCount || 0;
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error("Too many redirects"));
    const url = new URL(urlString);
    const timer = setTimeout(() => reject(new Error("POST timed out")), 10000);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timer);
        res.resume();
        return httpsPost(res.headers.location, body, redirectCount + 1).then(resolve).catch(reject);
      }
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
      });
      res.on("error", (err) => { clearTimeout(timer); reject(err); });
    });
    req.on("error", (err) => { clearTimeout(timer); reject(err); });
    req.write(body);
    req.end();
  });
}

async function getCount() {
  try {
    const result = await httpsGet(SHEET_SCRIPT_URL);
    console.log("getCount response:", JSON.stringify(result));
    if (result && typeof result.count !== "undefined") return Number(result.count);
    return 0;
  } catch (err) {
    console.error("getCount error:", err.message);
    return 0;
  }
}

async function sendToSheet(whatsapp) {
  try {
    const body = new URLSearchParams({
      whatsapp: whatsapp,
      joinedAt: new Date().toISOString(),
    }).toString();
    const result = await httpsPost(SHEET_SCRIPT_URL, body);
    console.log("sendToSheet response:", JSON.stringify(result));
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

  if (req.method === "GET") {
    const count = await getCount();
    return res.status(200).json({ count });
  }

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
        error: "Please provide a valid WhatsApp number.",
      });
    }

    await sendToSheet(whatsapp);
    const newCount = await getCount();

    return res.status(200).json({
      success: true,
      message: "You are on the list! We will reach out before launch.",
      count: newCount,
    });
  }

  return res.status(405).json({ success: false, error: "Method not allowed" });
};
