// api/waitlist.js

const https = require("https");

const SHEET_URL = "https://script.google.com/macros/s/AKfycbzzxI_MyKkLKdYJRHAzHNI46kezKOuEPIYvmAl6l0sH44iR7uA5LQcD6odBJpF7OQctJA/exec";
const BIN_ID  = "69d3de02856a68218905296f";
const BIN_KEY = "$2a$10$U36mKod7.UO4LNrj1.9SE.5LF8QDUgdTcGrWAUfero6Ta2DoDQdw6";

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
    const timer = setTimeout(() => reject(new Error("Request timed out")), 8000);
    try {
      const req = https.request({ hostname, path, method, headers }, (res) => {
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

async function getCount() {
  try {
    const result = await httpsRequest(
      "api.jsonbin.io",
      `/v3/b/${BIN_ID}`,
      "GET",
      { "X-Master-Key": BIN_KEY, "X-Bin-Meta": "false" },
      null
    );
    if (result && typeof result.count !== "undefined") return Number(result.count);
    return 0;
  } catch (err) {
    console.error("getCount error:", err.message);
    return 0;
  }
}

async function setCount(count) {
  try {
    const body = JSON.stringify({ count });
    await httpsRequest(
      "api.jsonbin.io",
      `/v3/b/${BIN_ID}`,
      "PUT",
      {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "X-Master-Key": BIN_KEY,
      },
      body
    );
  } catch (err) {
    console.error("setCount error:", err.message);
  }
}

// FIX: Google Apps Script requires form-encoded POST data, not JSON.
// Using application/x-www-form-urlencoded so the script can read
// e.parameter.whatsapp and e.parameter.joinedAt correctly.
async function sendToSheet(whatsapp) {
  try {
    const params = new URLSearchParams({
      whatsapp: whatsapp,
      joinedAt: new Date().toISOString(),
    });
    const body = params.toString();
    const u = new URL(SHEET_URL);

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
    console.log("Sheet response:", JSON.stringify(result));
    return result;
  } catch (err) {
    console.error("sendToSheet error:", err.message);
    // Don't throw — sheet failure shouldn't block the registration
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
        error: "Please provide a valid WhatsApp number."
      });
    }

    const currentCount = await getCount();
    const newCount = currentCount + 1;

    // Run both in parallel; sheet failure is logged but won't fail the request
    await Promise.all([
      sendToSheet(whatsapp),
      setCount(newCount),
    ]);

    return res.status(200).json({
      success: true,
      message: "You are on the list! We will reach out before launch.",
      count: newCount,
    });
  }

  return res.status(405).json({ success: false, error: "Method not allowed" });
};
