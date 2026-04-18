const API = '/api';
const token = localStorage.getItem('ra_token');
const user = JSON.parse(localStorage.getItem('ra_user') || 'null');

if (!token || !user || user.role !== 'owner') {
  window.location.href = 'login.html';
}

document.getElementById('navName').textContent = `Namaste, ${user.name}! 👋`;

// ===== MAP SETUP =====
const map = L.map('map').setView([28.6139, 77.2090], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

const ownerIcon = L.divIcon({
  html: '<div style="background:#FF6B35;width:36px;height:36px;border-radius:50%;border:3px solid white;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 8px rgba(0,0,0,0.3)">🚗</div>',
  className: '', iconSize: [36, 36], iconAnchor: [18, 18]
});

const techIcon = L.divIcon({
  html: '<div style="background:#00C851;width:36px;height:36px;border-radius:50%;border:3px solid white;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 8px rgba(0,0,0,0.3)">🔧</div>',
  className: '', iconSize: [36, 36], iconAnchor: [18, 18]
});

let ownerMarker = null;
let techMarkers = {};
let activeTechMarker = null;
let currentLat = null;
let currentLng = null;
let activeRequestId = null;
let selectedRating = 0;
let socket = null;

// ===== SOCKET.IO =====
function initSocket() {
  socket = io();

  socket.on('connect', () => {
    socket.emit('authenticate', token);
  });

  socket.on('authenticated', () => {
    console.log('Socket authenticated');
  });

  // Technician ne request accept ki
  socket.on('request-accepted-by-tech', (data) => {
    showToast('success', '✅ Technician Mil Gaya!', `${data.technician.name} aa raha hai!`);
    updateAfterAccept(data.technician);
  });

  // Technician ki location update
  socket.on('technician-location', (data) => {
    const [lng, lat] = [data.lng, data.lat];
    if (activeTechMarker) {
      activeTechMarker.setLatLng([lat, lng]);
    } else {
      activeTechMarker = L.marker([lat, lng], { icon: techIcon }).addTo(map);
      activeTechMarker.bindPopup('🔧 Technician aa raha hai').openPopup();
    }
  });

  // Chat message aaya
  socket.on('new-message', (data) => {
    if (data.requestId === activeRequestId) {
      appendChatMessage(data.message, false);
    }
  });

  // Request complete
  socket.on('request-done', () => {
    showToast('success', '✅ Kaam Ho Gaya!', 'Technician ne request complete ki');
    openRatingModal();
    resetDashboard();
  });
}

// ===== LOCATION TRACKING =====
function startLocationTracking() {
  if (!navigator.geolocation) {
    document.getElementById('locationStatus').innerHTML =
      '<span style="color:var(--danger)">GPS support nahi hai is device mein</span>';
    return;
  }

  navigator.geolocation.watchPosition(
    (pos) => {
      currentLat = pos.coords.latitude;
      currentLng = pos.coords.longitude;

      document.getElementById('locationStatus').innerHTML = `
        <div class="location-dot"></div>
        <span>Location mil gayi: ${currentLat.toFixed(4)}, ${currentLng.toFixed(4)}</span>
      `;
      document.getElementById('modalLocationText').textContent =
        `${currentLat.toFixed(5)}, ${currentLng.toFixed(5)}`;

      if (ownerMarker) {
        ownerMarker.setLatLng([currentLat, currentLng]);
      } else {
        ownerMarker = L.marker([currentLat, currentLng], { icon: ownerIcon }).addTo(map);
        ownerMarker.bindPopup('📍 Aapki Location').openPopup();
        map.setView([currentLat, currentLng], 14);
      }

      // Server ko location bhejo
      if (socket) socket.emit('update-location', { lat: currentLat, lng: currentLng });

      // Nearby technicians load karo (agar request active nahi hai)
      if (!activeRequestId) loadNearbyTechnicians();
    },
    (err) => {
      console.error('Location error:', err);
      document.getElementById('locationStatus').innerHTML =
        '<span style="color:var(--danger)">⚠️ Location access nahi mila — browser mein permission do</span>';
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
  );
}

// ===== LOAD NEARBY TECHNICIANS =====
async function loadNearbyTechnicians() {
  if (!currentLat) return;
  try {
    const res = await fetch(`${API}/technicians/nearby?lat=${currentLat}&lng=${currentLng}&radius=15`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    renderTechniciansList(data.technicians || []);

    // Map pe markers update karo
    Object.values(techMarkers).forEach(m => map.removeLayer(m));
    techMarkers = {};

    (data.technicians || []).forEach(tech => {
      if (tech.location?.coordinates && tech.location.coordinates[0] !== 0) {
        const [lng, lat] = tech.location.coordinates;
        const marker = L.marker([lat, lng], { icon: techIcon }).addTo(map);
        marker.bindPopup(`<b>🔧 ${tech.name}</b><br>${(tech.skills || []).join(', ')}<br>⭐ ${tech.rating?.toFixed(1) || 'N/A'}`);
        techMarkers[tech._id] = marker;
      }
    });

    document.getElementById('nearbySection').style.display = 'block';
  } catch (err) {
    console.error('Technicians load error:', err);
  }
}

function renderTechniciansList(technicians) {
  const el = document.getElementById('techniciansList');
  if (!technicians.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">😟</div>
        <h4>Koi technician nahi mila</h4>
        <p>15 km ke andar koi available nahi hai</p>
      </div>`;
    return;
  }

  el.innerHTML = technicians.map(t => `
    <div class="tech-card">
      <div class="tech-header">
        <div class="tech-avatar">${t.name[0].toUpperCase()}</div>
        <div class="tech-info">
          <h4>${t.name}</h4>
          <div class="tech-meta">📞 ${t.phone}</div>
        </div>
      </div>
      <div class="tech-skills">
        ${(t.skills || []).map(s => `<span class="tech-skill">${s}</span>`).join('')}
      </div>
      <div class="tech-footer">
        <span class="rating">⭐ ${t.rating?.toFixed(1) || 'New'}</span>
        <span class="status-badge badge-accepted">Available</span>
      </div>
    </div>
  `).join('');
}

// ===== SOS MODAL =====
function openSOSModal() {
  if (!currentLat) {
    showToast('warning', 'Location Chahiye', 'Pehle GPS on karo');
    return;
  }
  document.getElementById('sosModal').style.display = 'flex';
}

function closeSOSModal() {
  document.getElementById('sosModal').style.display = 'none';
}

let selectedProblem = '';

function selectProblem(el, problem) {
  document.querySelectorAll('.problem-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  selectedProblem = problem;
  document.getElementById('problemType').value = problem;
}

async function sendSOSRequest() {
  const vehicleType = document.getElementById('vehicleType').value;
  if (!vehicleType) { showToast('error', 'Vehicle type select karo', ''); return; }
  if (!selectedProblem) { showToast('error', 'Problem type select karo', ''); return; }

  const btn = document.getElementById('sendSOSBtn');
  btn.disabled = true;
  btn.textContent = 'Bhej raha hai...';

  try {
    const res = await fetch(`${API}/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        vehicleType,
        problemType: selectedProblem,
        description: document.getElementById('problemDesc').value,
        lat: currentLat,
        lng: currentLng,
        address: `${currentLat.toFixed(4)}, ${currentLng.toFixed(4)}`
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message);

    activeRequestId = data.request._id;
    closeSOSModal();
    showActiveRequestPanel(data.request);
    showToast('success', '🆘 SOS Bhej Diya!', 'Nearby technicians ko notify kiya gaya');

    // Socket se technicians ko notify karo
    socket.emit('new-request', activeRequestId);

    // Polling shuru karo status ke liye
    startRequestPolling();
  } catch (err) {
    showToast('error', 'Error', err.message);
    btn.disabled = false;
    btn.textContent = '🆘 Help Maango!';
  }
}

// ===== ACTIVE REQUEST UI =====
function showActiveRequestPanel(request) {
  document.getElementById('noRequestPanel').style.display = 'none';
  document.getElementById('activeRequestPanel').style.display = 'block';
  document.getElementById('nearbySection').style.display = 'none';

  document.getElementById('activeRequestStatus').textContent =
    request.status === 'pending' ? 'Technician dhundha ja raha hai...' :
    request.status === 'accepted' ? 'Technician aa raha hai!' : 'Kaam chal raha hai';
  document.getElementById('activeRequestProblem').textContent =
    `${request.vehicleType} • ${request.problemType}`;
}

function updateAfterAccept(technician) {
  document.getElementById('activeRequestStatus').textContent = 'Technician aa raha hai! 🏃';

  document.getElementById('technicianInfoPanel').style.display = 'block';
  document.getElementById('acceptedTechInfo').innerHTML = `
    <div class="tech-header" style="margin-bottom:0.8rem;">
      <div class="tech-avatar">${technician.name[0]}</div>
      <div class="tech-info">
        <h4>${technician.name}</h4>
        <div class="tech-meta">📞 <a href="tel:${technician.phone}">${technician.phone}</a></div>
      </div>
    </div>
    <div class="tech-skills" style="margin-bottom:6px;">
      ${(technician.skills || []).map(s => `<span class="tech-skill">${s}</span>`).join('')}
    </div>
    <div class="rating">⭐ ${technician.rating?.toFixed(1) || 'New'}</div>
  `;

  document.getElementById('chatSection').style.display = 'block';
  loadChatMessages();
}

async function cancelRequest() {
  if (!activeRequestId) return;
  if (!confirm('Request cancel karna chahte ho?')) return;

  try {
    await fetch(`${API}/requests/${activeRequestId}/cancel`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` }
    });
    showToast('warning', 'Request Cancel Ho Gayi', '');
    resetDashboard();
  } catch (err) {
    showToast('error', 'Error', err.message);
  }
}

async function completeRequest() {
  openRatingModal();
}

function resetDashboard() {
  activeRequestId = null;
  document.getElementById('noRequestPanel').style.display = 'block';
  document.getElementById('activeRequestPanel').style.display = 'none';
  document.getElementById('technicianInfoPanel').style.display = 'none';
  document.getElementById('chatSection').style.display = 'none';
  if (activeTechMarker) { map.removeLayer(activeTechMarker); activeTechMarker = null; }
  loadHistory();
  loadNearbyTechnicians();
}

// ===== CHAT =====
async function loadChatMessages() {
  if (!activeRequestId) return;
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
  if (!text || !activeRequestId) return;
  socket.emit('send-message', { requestId: activeRequestId, text });
  input.value = '';
}

// ===== RATING =====
function openRatingModal() {
  document.getElementById('ratingModal').style.display = 'flex';
}

function setRating(n) {
  selectedRating = n;
  document.querySelectorAll('.star').forEach((s, i) => {
    s.classList.toggle('active', i < n);
  });
}

async function submitRating() {
  if (!selectedRating || !activeRequestId) {
    showToast('warning', 'Rating do pehle', '');
    return;
  }
  try {
    await fetch(`${API}/requests/${activeRequestId}/complete`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ rating: selectedRating })
    });
    socket.emit('request-completed', activeRequestId);
    document.getElementById('ratingModal').style.display = 'none';
    showToast('success', '✅ Done!', 'Rating dene ke liye shukriya');
    resetDashboard();
  } catch (err) {
    showToast('error', 'Error', err.message);
  }
}

// ===== POLLING (fallback for socket) =====
let pollingInterval = null;
function startRequestPolling() {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(async () => {
    if (!activeRequestId) { clearInterval(pollingInterval); return; }
    try {
      const res = await fetch(`${API}/requests/my-active`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!data.request) { clearInterval(pollingInterval); return; }
      if (data.request.status === 'accepted' && data.request.technician && !document.getElementById('technicianInfoPanel').style.display.includes('block')) {
        updateAfterAccept(data.request.technician);
      }
    } catch (err) {
      console.error(err);
    }
  }, 5000);
}

// ===== HISTORY =====
async function loadHistory() {
  try {
    const res = await fetch(`${API}/requests/my-history`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    const el = document.getElementById('historyList');
    if (!data.requests?.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>Abhi tak koi request nahi</p></div>';
      return;
    }
    el.innerHTML = data.requests.slice(0, 5).map(r => `
      <div style="padding:0.8rem; border-bottom:1px solid #f0f0f0; last-child:border-none;">
        <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:4px;">
          <span style="font-weight:600; font-size:0.9rem;">${r.vehicleType} • ${r.problemType}</span>
          <span class="status-badge badge-${r.status}">${r.status}</span>
        </div>
        <div style="font-size:0.8rem; color:var(--text-light);">
          ${r.technician ? `🔧 ${r.technician.name}` : 'Technician nahi mila'} •
          ${new Date(r.createdAt).toLocaleDateString('hi-IN')}
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

// ===== TOAST =====
function showToast(type, title, msg) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<div class="toast-title">${title}</div>${msg ? `<div class="toast-msg">${msg}</div>` : ''}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ===== LOGOUT =====
function logout() {
  localStorage.removeItem('ra_token');
  localStorage.removeItem('ra_user');
  if (socket) socket.disconnect();
  window.location.href = 'login.html';
}

// ===== CHECK ACTIVE REQUEST =====
async function checkActiveRequest() {
  try {
    const res = await fetch(`${API}/requests/my-active`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.request) {
      activeRequestId = data.request._id;
      showActiveRequestPanel(data.request);
      if (data.request.technician) {
        updateAfterAccept(data.request.technician);
      }
      startRequestPolling();
    }
  } catch (err) {
    console.error(err);
  }
}

// ===== INIT =====
initSocket();
startLocationTracking();
checkActiveRequest();
loadHistory();
