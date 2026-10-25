const express = require("express");
const fs = require("fs");
const http = require("http");
const https = require("https");
const cors = require("cors");
const path = require("path");

// ----------------- Config -----------------

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const DATA_FILE = path.resolve(process.env.DATA_FILE || path.join(__dirname, "users.json"));
const CERT_DIR = path.join(__dirname, "certs");
const TICK_MS = 12 * 60 * 60 * 1000; // background job interval
const REFILL_THRESHOLD = 1; // days

// Comma-separated list, e.g. ALLOWED_ORIGINS=https://khameer13.github.io,http://localhost:5500
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "https://khameer13.github.io")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const app = express();

app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    optionsSuccessStatus: 204,
  })
);
app.use(express.json({ limit: "100kb" }));

// Serve only the front-end files (never server.js, users.json or certs).
const FRONTEND = { "/": "index.html", "/index.html": "index.html", "/index.js": "index.js", "/styles.css": "styles.css" };
for (const [route, file] of Object.entries(FRONTEND)) {
  app.get(route, (req, res) => res.sendFile(path.join(__dirname, file)));
}

// ----------------- Storage -----------------

function readUsers() {
  let raw;
  try {
    raw = fs.readFileSync(DATA_FILE, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  if (!raw.trim()) return [];
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error("users.json must contain an array");
  return data.filter((u) => u && typeof u === "object" && u.phone);
}

// Write to a temp file and rename so a crash never leaves half-written JSON.
function writeUsers(users) {
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

// ----------------- Validation -----------------

const NAME_RE = /^[A-Za-z][A-Za-z .'-]{0,79}$/;
const PHONE_RE = /^\d{10}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

// Returns { user } with only known fields, or { error }.
function validateUser(body) {
  if (!body || typeof body !== "object") return { error: "Request body must be a JSON object" };
  const name = str(body.name, 80).replace(/\s+/g, " ");
  const phone = str(body.phone, 10);
  const email = str(body.email, 120);
  const address = str(body.address, 200);

  if (!NAME_RE.test(name)) return { error: "Name is required (letters, spaces, . ' -)" };
  if (!PHONE_RE.test(phone)) return { error: "Phone must be exactly 10 digits" };
  if (email && !EMAIL_RE.test(email)) return { error: "Email address is invalid" };

  const medsIn = body.medicines === undefined ? [] : body.medicines;
  if (!Array.isArray(medsIn) || medsIn.length > 50) return { error: "medicines must be an array (max 50)" };
  const medicines = [];
  for (const m of medsIn) {
    const medName = str(m && m.name, 80);
    const daysLeft = Number(m && m.daysLeft);
    if (!medName) return { error: "Each medicine needs a name" };
    if (!Number.isFinite(daysLeft) || daysLeft < 0 || daysLeft > 365) {
      return { error: `daysLeft for ${medName} must be a number from 0 to 365` };
    }
    medicines.push({ name: medName, daysLeft });
  }

  return { user: { name, phone, email, address, medicines } };
}

// ----------------- API Endpoints -----------------

app.get("/api/health", (req, res) => res.json({ ok: true, app: "trackmymeds" }));

app.get("/users", (req, res, next) => {
  try {
    res.json(readUsers());
  } catch (err) {
    next(err);
  }
});

app.post("/users", (req, res, next) => {
  const { user, error } = validateUser(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const users = readUsers();
    if (users.some((u) => u.phone === user.phone)) {
      return res.status(409).json({ error: "A customer with this phone number already exists" });
    }
    users.push(user);
    writeUsers(users);
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

// :phone is the customer's current phone; the body may contain a new phone.
app.put("/users/:phone", (req, res, next) => {
  const { user, error } = validateUser(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const users = readUsers();
    const index = users.findIndex((u) => u.phone === req.params.phone);
    if (index === -1) return res.status(404).json({ error: "Customer not found" });
    if (user.phone !== req.params.phone && users.some((u) => u.phone === user.phone)) {
      return res.status(409).json({ error: "A customer with this phone number already exists" });
    }
    users[index] = user;
    writeUsers(users);
    res.json(user);
  } catch (err) {
    next(err);
  }
});

app.delete("/users/:phone", (req, res, next) => {
  try {
    const users = readUsers();
    const remaining = users.filter((u) => u.phone !== req.params.phone);
    if (remaining.length === users.length) return res.status(404).json({ error: "Customer not found" });
    writeUsers(remaining);
    res.json({ message: "Customer deleted" });
  } catch (err) {
    next(err);
  }
});

app.use((req, res) => res.status(404).json({ error: "Not found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body" });
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// ----------------- Background Job -----------------

// Every 12 hours each medicine's supply goes down by half a day.
// When it drops to REFILL_THRESHOLD or below, a reminder is logged
// (sending an SMS is left as a hook — see sendReminder).
function sendReminder(user, med) {
  const left = med.daysLeft === 0 ? "no" : med.daysLeft;
  console.log(`Reminder for ${user.phone}: only ${left} day(s) of ${med.name} left. Please refill.`);
}

function updateMedicineTimers() {
  let users;
  try {
    users = readUsers();
  } catch (err) {
    return console.error("Background job: could not read users:", err.message);
  }

  let updated = false;
  for (const user of users) {
    for (const med of user.medicines || []) {
      if (typeof med.daysLeft === "number" && med.daysLeft > 0) {
        med.daysLeft = Math.max(0, med.daysLeft - 0.5);
        updated = true;
        if (med.daysLeft <= REFILL_THRESHOLD) sendReminder(user, med);
      }
    }
  }

  if (updated) {
    try {
      writeUsers(users);
      console.log("Medicine timers updated.");
    } catch (err) {
      console.error("Background job: could not save users:", err.message);
    }
  }
}

// ----------------- Start -----------------

if (require.main === module) {
  setInterval(updateMedicineTimers, TICK_MS);

  const keyPath = path.join(CERT_DIR, "key.pem");
  const certPath = path.join(CERT_DIR, "cert.pem");
  const useHttps = fs.existsSync(keyPath) && fs.existsSync(certPath);
  const server = useHttps
    ? https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app)
    : http.createServer(app);

  server.listen(PORT, HOST, () => {
    const scheme = useHttps ? "https" : "http";
    console.log(`TrackMyMeds running at ${scheme}://localhost:${PORT}`);
    console.log(`Allowed CORS origins: ${ALLOWED_ORIGINS.join(", ")}`);
  });
}

module.exports = { app, updateMedicineTimers, validateUser };
