let users = [];
let editingUserIndex = null; // Track user index being edited

function updateMedicineTimersAndNotify() {
  let Messages = [];

  users.forEach((user) => {
    if (!user.medicines || !Array.isArray(user.medicines)) return;

    const lowStockMeds = [];
    user.medicines.forEach((med) => {
      if (med.daysLeft <= 1) {
        lowStockMeds.push(`${med.name} (${med.daysLeft.toFixed(1)} days left)`);
      }
    });

    if (lowStockMeds.length > 0) {
      const message =
        `🔔 Reminder for ${user.name} (${user.phone}):\n` +
        `Please refill the following medicines:\n` +
        lowStockMeds.map((med) => `${med}`).join("\n");

      Messages.push(message);
    }
  });

  // For debugging or integration with notifications
  Messages.forEach((msg) => console.log(msg));
  renderMessages(Messages);
}

function renderMessages(messages) {
  const listContainer = document.getElementById("messagesList");
  listContainer.innerHTML = "";

  if (!messages.length) {
    const noMsg = document.createElement("li");
    noMsg.textContent = "No medicine refill alerts.";
    listContainer.appendChild(noMsg);
    return;
  }

  messages.forEach((msg) => {
    const li = document.createElement("li");
    li.textContent = msg;
    listContainer.appendChild(li);
  });
}

function loadUsers() {
  fetch("http://localhost:3000/users")
    .then((response) => response.json())
    .then((data) => {
      users = data;
      renderUsers(users);
    })
    .catch((err) => {
      console.error("Failed to load users:", err);
    });

  updateMedicineTimersAndNotify();
}

function renderUsers(userList) {
  const container = document.getElementById("userCards");
  container.innerHTML = "";
  if (!(userList.length && Object.keys(userList[0]).length)) {
    const noDataCard = document.createElement("div");
    noDataCard.className = "user-card no-data";
    noDataCard.style.textAlign = "center";
    noDataCard.style.padding = "2rem";
    noDataCard.style.border = "2px dashed #ccc";
    noDataCard.innerHTML = `
      <h3>No Data Maintained</h3>
      <p>No Customers have been added yet.</p>
    `;
    container.appendChild(noDataCard);
    return;
  }

  // Proceed with rendering users
  userList.forEach((user, index) => {
    const card = document.createElement("div");
    card.className = "user-card";
    card.innerHTML = `
      <div class="card-actions">
        <button onclick="editUser(${index})">Edit</button>
        <button onclick="deleteUser(${index})" style="background-color:#dc3545; color:white;">Delete</button>
      </div>
      <h3>${user.name}</h3>
      <p><strong>Phone:</strong> ${user.phone}</p>
      <p><strong>Email:</strong> ${user.email || "N/A"}</p>
      <p><strong>Address:</strong> ${user.address || "N/A"}</p>
      <strong>Medicines</strong>
      <ul>
        ${
          user.medicines && user.medicines.length > 0
            ? user.medicines
                .map(
                  (med) => `<li>${med.name} (${med.daysLeft} days left)</li>`
                )
                .join("")
            : "<li>No medicines listed</li>"
        }
      </ul>
    `;
    container.appendChild(card);
  });
}

function filterUsers(query) {
  if (!query) {
    renderUsers(users);
    return;
  }
  const filteredUsers = users.filter(
    (user) =>
      user.name.toLowerCase().includes(query.toLowerCase()) ||
      user.phone.includes(query)
  );
  renderUsers(filteredUsers);
}

function openModal() {
  const modal = document.getElementById("userModal");
  modal.style.display = "block";
  clearModalFields();
  editingUserIndex = null; // reset edit state
  document.querySelector(".modal-content h3").textContent = "Add New User";
}

function closeModal() {
  const modal = document.getElementById("userModal");
  modal.style.display = "none";
}

function clearModalFields() {
  document.getElementById("name").value = "";
  document.getElementById("phone").value = "";
  document.getElementById("email").value = "";
  document.getElementById("address").value = "";
  document.getElementById("medicines").value = "";
}

function submitUser() {
  const name = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const email = document.getElementById("email").value.trim();
  const address = document.getElementById("address").value.trim();
  const medInput = document.getElementById("medicines").value.trim();

  if (!name) {
    alert("Error: Name field cannot be empty.");
    return;
  }
  if (!/^[a-zA-Z\s]+$/.test(name)) {
    alert("Error: Name must contain only alphabets and spaces.");
    return;
  }

  if (!phone) {
    alert("Error: Phone number is required.");
    return;
  }
  if (!/^\d{10}$/.test(phone)) {
    alert("Error: Phone number must be exactly 10 digits.");
    return;
  }

  if (email && !/\S+@\S+\.\S+/.test(email)) {
    if (
      !confirm(
        "Warning: The email format appears invalid. Do you want to proceed?"
      )
    ) {
      return;
    }
  }

  if (!address) {
    if (
      !confirm(
        "Warning: Address is empty. Do you want to proceed without address?"
      )
    ) {
      return;
    }
  }

  if (!medInput) {
    if (
      !confirm(
        "Warning: Medicines list is empty. Do you want to proceed without medicines?"
      )
    ) {
      return;
    }
  }

  const medicines = medInput
    ? medInput.split(",").map((m) => {
        const [medName, daysLeft] = m.split("-");
        return { name: medName.trim(), daysLeft: parseFloat(daysLeft) };
      })
    : [];

  const userData = { name, phone, email, address, medicines };

  if (editingUserIndex !== null) {
    // Editing existing user
    users[editingUserIndex] = userData;
    updateUser(editingUserIndex, userData);
  } else {
    // Adding new user
    users.push(userData);
    saveUser(userData);
  }

  renderUsers(users);
  closeModal();
}

function saveUser(user) {
  fetch("http://localhost:3000/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(user),
  })
    .then((response) => {
      if (!response.ok) throw new Error("Failed to save user");
      console.log("User saved successfully");
    })
    .catch((error) => {
      console.error("Error:", error);
      alert("An error occurred while saving user data.");
    });
}

function updateUser(index, user) {
  fetch(`http://localhost:3000/users/${user.phone}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(user),
  })
    .then((response) => {
      if (!response.ok) throw new Error("Failed to update user");
      console.log("User updated successfully");
    })
    .catch((error) => {
      console.error("Error:", error);
      alert("An error occurred while updating user data.");
    });
}

function deleteUser(index) {
  if (!confirm(`Are you sure you want to delete user: ${users[index].name}?`)) {
    return;
  }

  const userToDelete = users[index];
  // Remove from local array
  users.splice(index, 1);
  renderUsers(users);

  // Delete on backend (assuming phone is unique ID)
  fetch(`http://localhost:3000/users/${userToDelete.phone}`, {
    method: "DELETE",
  })
    .then((response) => {
      if (!response.ok) throw new Error("Failed to delete user");
      console.log("User deleted successfully");
    })
    .catch((error) => {
      console.error("Error:", error);
      alert("An error occurred while deleting user data.");
    });
}

function editUser(index) {
  editingUserIndex = index;
  const user = users[index];
  document.getElementById("name").value = user.name;
  document.getElementById("phone").value = user.phone;
  document.getElementById("email").value = user.email || "";
  document.getElementById("address").value = user.address || "";
  document.getElementById("medicines").value = user.medicines
    .map((med) => `${med.name}-${med.daysLeft}`)
    .join(",");

  const modal = document.getElementById("userModal");
  modal.style.display = "block";
  document.querySelector(".modal-content h3").textContent = "Edit User";
}

// Optional: close modal on outside click
window.onclick = function (event) {
  const modal = document.getElementById("userModal");
  if (event.target === modal) {
    closeModal();
  }
};

window.onload = loadUsers;
