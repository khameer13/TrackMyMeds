const express = require("express");
const fs = require("fs");
const cors = require("cors");
const path = require("path");
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const FILE_PATH = path.resolve(__dirname, "users.json");

// ----------------- API Endpoints -----------------

app.get("/users", (req, res) => {
  fs.readFile(FILE_PATH, (err, data) => {
    if (err)
      return res
        .status(500)
        .json({ error: "Error reading file", details: err.message });
    data.length ? res.json(JSON.parse(data)) : res.json([{}]);
  });
});

app.post("/users", (req, res) => {
  fs.readFile(FILE_PATH, (err, data) => {
    if (err)
      return res
        .status(500)
        .json({ error: "Error reading file", details: err.message });

    const users = JSON.parse(data);
    const newUser = req.body;

    if (!newUser.name || !newUser.phone) {
      return res.status(400).json({ error: "Missing required user fields" });
    }

    users.push(newUser);

    fs.writeFile(FILE_PATH, JSON.stringify(users, null, 2), (err) => {
      if (err)
        return res
          .status(500)
          .json({ error: "Error writing file", details: err.message });
      res.status(201).json({ message: "User added successfully" });
    });
  });
});

app.delete("/users/:phone", (req, res) => {
  const phone = req.params.phone;

  fs.readFile(FILE_PATH, (err, data) => {
    if (err) return res.status(500).json({ error: "Error reading file" });

    let users = JSON.parse(data);
    const initialLength = users.length;

    users = users.filter((user) => user.phone !== phone);

    if (users.length === initialLength) {
      return res.status(404).json({ error: "User not found" });
    }

    fs.writeFile(FILE_PATH, JSON.stringify(users, null, 2), (err) => {
      if (err)
        return res
          .status(500)
          .json({ error: "Error writing file", details: err.message });

      res.json({ message: "User deleted successfully" });
    });
  });
});

app.put("/users/:phone", (req, res) => {
  const phone = req.params.phone;
  const updatedUser = req.body;

  fs.readFile(FILE_PATH, (err, data) => {
    if (err)
      return res
        .status(500)
        .json({ error: "Error reading user data", details: err.message });

    let users = JSON.parse(data);
    const userIndex = users.findIndex((user) => user.phone === phone);

    if (userIndex === -1) {
      return res.status(404).json({ error: "User not found" });
    }

    users[userIndex] = updatedUser;

    fs.writeFile(FILE_PATH, JSON.stringify(users, null, 2), (err) => {
      if (err)
        return res
          .status(500)
          .json({ error: "Error saving updated data", details: err.message });

      res.json({ message: "User updated successfully" });
    });
  });
});

// ----------------- Background Job -----------------

function updateMedicineTimersAndNotify() {
  fs.readFile(FILE_PATH, (err, data) => {
    if (err) return console.error("⛔ Failed to read users for update:", err);

    let users;
    try {
      users = data.length ? JSON.parse(data) : [{}];
    } catch (e) {
      return console.error("⛔ Invalid user JSON format:", e);
    }

    let updated = false;

    users.forEach((user) => {
      if (!user.medicines || !Array.isArray(user.medicines)) return;

      user.medicines.forEach((med) => {
        if (typeof med.daysLeft === "number" && med.daysLeft > 0) {
          med.daysLeft = Math.max(0, med.daysLeft - 0.5);
          updated = true;

          if (med.daysLeft <= 1) {
            const message = `Reminder: Only ${
              med.daysLeft === 0 ? "no" : med.daysLeft
            } day(s) of ${med.name} left. Please refill. — Knox Medicals`;
            //  sendSMS(user.phone, message);
            console.log(`📩 SMS sent to ${user.phone} regarding ${med.name}`);
          }
        }
      });
    });

    if (updated) {
      fs.writeFile(FILE_PATH, JSON.stringify(users, null, 2), (err) => {
        if (err) return console.error("⛔ Failed to write updated users:", err);
        console.log("✅ Medicine timers updated and saved.");
      });
    }
  });
}

// Run every 12 hours (12 * 60 * 60 * 1000 ms)
setInterval(updateMedicineTimersAndNotify, 12 * 60 * 60 * 1000);

// Run once immediately on startup
updateMedicineTimersAndNotify();

// ----------------- Start Server -----------------

app.listen(PORT, () => {
  console.log(`✅ Server is operational and listening on port ${PORT}`);
});
