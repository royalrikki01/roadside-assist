const API = '/api';
const token = localStorage.getItem('ra_token');
const user = JSON.parse(localStorage.getItem('ra_user') || 'null');

if (!token || !user || user.role !== 'technician') {
  window.location.href = 'login.html';
}

document.getElementById('navName').textContent = `Namaste, ${user.name}! 🔧`;

// ===== MAP SETUP =====
const map = L.map('map').setView([28.6139, 77.2090], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

const techSelfIcon = L.divIcon({
  html: '<div style="background:#00C851;width:36px;height:36px;border-radius:50%;border:3px solid white;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 8px rgba(0,0,0,0.3)">🔧</div>',
  className: '', iconSize: [36, 36], iconAnchor: [18, 18]
});

const ownerIcon = L.divIcon({
  html: '<div style="background:#FF6B35;width:36px;height:36px;border-radius:50%;border:3px solid white;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 8px rgba(0,0,0,0.3)">🚗</div>',
  className: '', iconSize: [36, 36], iconAnchor: [18, 18]
});

const reqIcon = L.divIcon({
  html: '<div style="background:#ff4444;width:40px;height:40px;border-radius:50%;border:3px solid white;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 2px 8px rgba(0,0,0,0.3);animation:pulse 1s infinite">🆘</div>',
  className: '', iconSize: [40, 40], iconAnchor: [20, 20]
});

let selfMarker = null;
let ownerMarker = null;
let requestMarkers = {};
let currentLat = null;
let currentLng = null;
let activeJobId = null;
let pendingRequestData = null;
let socket = null;

// ===== PROFILE =====
document.getElementById('profileInfo').innerHTML = `
  <div style="display:flex; align-items:center; gap:12px; margin-bottom:1rem;">
    <div class="tech-avatar" style="width:50px;height:50px;font-size:1.3rem;">${user.name[0]}</div>
    <div>
      <div style="font-weight:700;">${user.name}</div>
      <div style="font-size:0.82rem; color:var(--text-light);">📞 ${user.phone}</div>
    </div>
  </div>
  <div class="tech-skills">
    ${(user.skills || []).map(s => `<span class="tech-skill">${s}</span>`).join('')}
  </div>
  <div style="margin-top:8px; font-size:0.85rem; color:var(--text-light);">
    ⭐ Rating: ${user.rating?.toFixed(1) || 'N/A'}
  </div>
`;

// ===== SOCKET.IO =====
function initSocket() {
  socket = io();

  socket.on('connect', () => {
    socket.emit('authenticate', token);
  });

  socket.on('authenticated', () => {
    console.log('Technician socket authenticated');
  });

  // Naya nearby request aaya
  socket.on('new-request-nearby', (data) => {
    if (activeJobId) return; // Pehle se job chal rahi hai

    pendingRequestData = data;
    showIncomingRequestModal(data);
    showToast('warning', '🆘 Naya Emergency!', `${data.ownerName} ki madad chahiye`);

    // Map pe location dikhao
    if (data.location) {
      const { lat, lng } = data.location;
      if (requestMarkers[data.requestId]) map.removeLayer(requestMarkers[data.requestId]);
      requestMarkers[data.requestId] = L.marker([lat, lng], { icon: reqIcon }).addTo(map);
      requestMarkers[data.requestId].bindPopup(`<b>🆘 Emergency!</b><br>${data.ownerName}<br>${data.vehicleType} - ${data.problemType}`).openPopup();
      map.setView([lat, lng], 14);
    }
  });

  // Owner ki location update (jab active job ho)
  socket.on('owner-location', (data) => {
    const { lat, lng } = data;
    if (ownerMarker) {
      ownerMarker.setLatLng([lat, lng]);
    }
  });

  // Chat message
  socket.on('new-message', (data) => {
    if (data.requestId === activeJobId) {
      appendChatMessage(data.message, false);
    }
  });

  // Request complete by owner
  socket.on('request-done', () => {
    showToast('success', '✅ Job Complete!', 'Owner ne job complete mark kiya');
    resetDashboard();
  });
}

// ===== LOCATION TRACKING =====
function startLocationTracking() {
  if (!navigator.geolocation) return;

  navigator.geolocation.watchPosition(
    async (pos) => {
      currentLat = pos.coords.latitude;
      currentLng = pos.coords.longitude;

      document.getElementById('locationStatus').innerHTML = `
        <div class="location-dot"></div>
        <span>Location: ${currentLat.toFixed(4)}, ${currentLng.toFixed(4)}</span>
      `;

      if (selfMarker) {
        selfMarker.setLatLng([currentLat, currentLng]);
      } else {
        selfMarker = L.marker([currentLat, currentLng], { icon: techSelfIcon }).addTo(map);
        selfMarker.bindPopup('📍 Aapki Location').openPopup();
        map.setView([currentLat, currentLng], 13);
      }

      // Server ko location update bhejo
      if (socket) socket.emit('update-location', { lat: currentLat, lng: currentLng });

      // Nearby requests load karo (agar available hai)
      if (document.getElementById('availabilityToggle').checked) {
        loadNearbyRequests();
      }
    },
    (err) => {
      document.getElementById('locationStatus').innerHTML =
        '<span style="color:var(--danger)">⚠️ Location access nahi mila</span>';
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
  );
}

// ===== AVAILABILITY =====
async function toggleAvailability() {
  const isAvailable = document.getElementById('availabilityToggle').checked;
  document.getElementById('availabilityText').textContent =
    isAvailable ? '✅ Available hoon — requests aa sakti hain' : 'Abhi offline hoon';

  try {
    await fetch(`${API}/auth/availability`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ isAvailable })
    });

    showToast(isAvailable ? 'success' : 'warning',
      isAvailable ? '✅ Ab Aap Available Hain!' : '⭕ Offline Ho Gaye',
      isAvailable ? 'Nearby requests aayengi' : 'Koi request nahi aayegi');

    if (isAvailable) loadNearbyRequests();
    else {
      Object.values(requestMarkers).forEach(m => map.removeLayer(m));
      requestMarkers = {};
      document.getElementById('nearbyRequests').innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📡</div>
          <h4>Available ON karo</h4>
          <p>Taaki nearby requests dikhen</p>
        </div>`;
    }
  } catch (err) {
    showToast('error', 'Error', err.message);
  }
}

// ===== NEARBY REQUESTS =====
async function loadNearbyRequests() {
  if (!currentLat || activeJobId) return;
  try {
    const res = await fetch(`${API}/requests/nearby-requests?lat=${currentLat}&lng=${currentLng}&radius=15`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    renderNearbyRequests(data.requests || []);

    // Map pe markers
    Object.values(requestMarkers).forEach(m => map.removeLayer(m));
    requestMarkers = {};
    (data.requests || []).forEach(r => {
      const [lng, lat] = r.ownerLocation.coordinates;
      const marker = L.marker([lat, lng], { icon: reqIcon }).addTo(map);
      marker.bindPopup(`<b>🆘 ${r.owner?.name}</b><br>${r.vehicleType} • ${r.problemType}`);
      requestMarkers[r._id] = marker;
    });
  } catch (err) {
    console.error(err);
  }
}

function renderNearbyRequests(requests) {
  const el = document.getElementById('nearbyRequests');
  if (!requests.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">😌</div>
        <h4>Abhi koi request nahi</h4>
        <p>Jab koi vehicle owner SOS karega, yahan dikhega</p>
      </div>`;
    return;
  }

  el.innerHTML = requests.map(r => `
    <div class="tech-card" onclick="viewRequestOnMap('${r._id}', ${r.ownerLocation.coordinates[1]}, ${r.ownerLocation.coordinates[0]})">
      <div class="tech-header">
        <div class="tech-avatar" style="background:var(--danger)">${r.owner?.name?.[0] || '?'}</div>
        <div class="tech-info">
          <h4>${r.owner?.name || 'Unknown'}</h4>
          <div class="tech-meta">${r.vehicleType} • ${r.problemType}</div>
        </div>
      </div>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <span class="status-badge badge-pending">Pending</span>
        <button class="btn btn-success btn-sm" onclick="event.stopPropagation(); quickAccept('${r._id}')">
          ✅ Accept
        </button>
      </div>
    </div>
  `).join('');
}

function viewRequestOnMap(id, lat, lng) {
  if (requestMarkers[id]) {
    map.setView([lat, lng], 15);
    requestMarkers[id].openPopup();
  }
}

// ===== INCOMING REQUEST MODAL =====
function showIncomingRequestModal(data) {
  document.getElementById('incOwnerName').textContent = data.ownerName || '-';
  document.getElementById('incOwnerPhone').textContent = data.ownerPhone || '-';
  document.getElementById('incVehicleType').textContent = data.vehicleType || '-';
  document.getElementById('incProblem').textContent = data.problemType || '-';
  document.getElementById('incDescription').textContent = data.description || '';
  document.getElementById('incDescWrapper').style.display = data.description ? 'block' : 'none';

  if (data.location) {
    document.getElementById('incLocationInfo').textContent =
      `📍 Location: ${data.location.lat?.toFixed(4)}, ${data.location.lng?.toFixed(4)}`;
  }

  document.getElementById('incomingModal').style.display = 'flex';
}

function rejectRequest() {
  document.getElementById('incomingModal').style.display = 'none';
  pendingRequestData = null;
  showToast('warning', 'Request Reject Kiya', '');
}

async function acceptRequest() {
  if (!pendingRequestData) return;
  const btn = document.getElementById('acceptBtn');
  btn.disabled = true;
  btn.textContent = 'Accept ho raha hai...';

  try {
    const res = await fetch(`${API}/requests/${pendingRequestData.requestId}/accept`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);

    activeJobId = pendingRequestData.requestId;
    document.getElementById('incomingModal').style.display = 'none';

    // Socket se owner ko notify karo
    socket.emit('request-accepted', activeJobId);

    showActiveJob(data.request);
    showToast('success', '✅ Request Accept Kiya!', `${data.request.owner?.name} ki help karo`);
    pendingRequestData = null;
  } catch (err) {
    showToast('error', 'Error', err.message);
    btn.disabled = false;
    btn.textContent = '✅ Accept';
  }
}

async function quickAccept(requestId) {
  pendingRequestData = { requestId };
  await acceptRequest();
}

// ===== ACTIVE JOB =====
function showActiveJob(request) {
  document.getElementById('activeJobPanel').style.display = 'block';
  document.getElementById('chatSection').style.display = 'block';

  const owner = request.owner;
  document.getElementById('activeJobInfo').innerHTML = `
    <div class="tech-header" style="margin-bottom:0.8rem;">
      <div class="tech-avatar" style="background:var(--primary)">${owner?.name?.[0] || '?'}</div>
      <div class="tech-info">
        <h4>${owner?.name || 'Unknown'}</h4>
        <div class="tech-meta">📞 <a href="tel:${owner?.phone}">${owner?.phone}</a></div>
      </div>
    </div>
    <div style="background:var(--bg); border-radius:8px; padding:0.8rem; font-size:0.85rem;">
      <div><b>Vehicle:</b> ${request.vehicleType}</div>
      <div><b>Problem:</b> ${request.problemType}</div>
      ${request.description ? `<div style="margin-top:4px; color:var(--text-light);">${request.description}</div>` : ''}
    </div>
    <div style="margin-top:0.8rem; font-size:0.8rem; color:var(--text-light);">
      📍 ${request.address || request.ownerLocation?.coordinates?.join(', ')}
    </div>
  `;

  // Owner ko map pe dikhao
  const [lng, lat] = request.ownerLocation?.coordinates || [0, 0];
  if (lat && lng) {
    if (ownerMarker) map.removeLayer(ownerMarker);
    ownerMarker = L.marker([lat, lng], { icon: ownerIcon }).addTo(map);
    ownerMarker.bindPopup(`<b>🚗 ${owner?.name}</b><br>Yahan hai`).openPopup();
    if (selfMarker) {
      map.fitBounds([
        [lat, lng],
        [currentLat || lat, currentLng || lng]
      ], { padding: [50, 50] });
    } else {
      map.setView([lat, lng], 14);
    }
  }

  // Nearby requests hide karo
  Object.values(requestMarkers).forEach(m => map.removeLayer(m));
  requestMarkers = {};
  loadChatMessages();
}

async function completeJob() {
  if (!activeJobId) return;
  try {
    await fetch(`${API}/requests/${activeJobId}/complete`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({})
    });
    socket.emit('request-completed', activeJobId);
    showToast('success', '✅ Job Complete!', 'Badiya kaam kiya!');
    resetDashboard();
  } catch (err) {
    showToast('error', 'Error', err.message);
  }
}

function resetDashboard() {
  activeJobId = null;
  document.getElementById('activeJobPanel').style.display = 'none';
  document.getElementById('chatSection').style.display = 'none';
  if (ownerMarker) { map.removeLayer(ownerMarker); ownerMarker = null; }
  if (currentLat) loadNearbyRequests();
}

// ===== CHAT =====
async function loadChatMessages() {
  if (!activeJobId) return;
  try {
    const res = await fetch(`${API}/requests/my-active`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.request?.messages) {
      const chatEl = document.getElementById('chatMessages');
      chatEl.innerHTML = '';
      data.request.messages.forEach(msg => appendChatMessage(msg, true));
    }
  } catch (err) {
    console.error(err);
  }
}

function appendChatMessage(msg, scroll = true) {
  const chatEl = document.getElementById('chatMessages');
  const isMine = msg.senderName === user.name || msg.sender === user.id;
  const div = document.createElement('div');
  div.className = `chat-msg ${isMine ? 'mine' : 'theirs'}`;
  div.innerHTML = `
    ${!isMine ? `<div class="msg-sender">${msg.senderName}</div>` : ''}
    ${msg.text}
    <div class="msg-time">${new Date(msg.time).toLocaleTimeString('hi-IN', { hour: '2-digit', minute: '2-digit' })}</div>
  `;
  chatEl.appendChild(div);
  if (scroll) chatEl.scrollTop = chatEl.scrollHeight;
}

function sendMessage() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text || !activeJobId) return;
  socket.emit('send-message', { requestId: activeJobId, text });
  input.value = '';
}

// ===== TOAST =====
function showToast(type, title, msg) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<div class="toast-title">${title}</div>${msg ? `<div class="toast-msg">${msg}</div>` : ''}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// ===== LOGOUT =====
function logout() {
  localStorage.removeItem('ra_token');
  localStorage.removeItem('ra_user');
  if (socket) socket.disconnect();
  window.location.href = 'login.html';
}

// ===== CHECK ACTIVE JOB =====
async function checkActiveJob() {
  try {
    const res = await fetch(`${API}/requests/my-active`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.request) {
      activeJobId = data.request._id;
      document.getElementById('availabilityToggle').checked = true;
      document.getElementById('availabilityText').textContent = '✅ Available hoon';
      showActiveJob(data.request);
    }
  } catch (err) {
    console.error(err);
  }
}

// ===== INIT =====
initSocket();
startLocationTracking();
checkActiveJob();
