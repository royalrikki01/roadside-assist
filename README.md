# 🚗 RoadHelp - Vehicle Emergency Assistant

Gaadi kharab? Ghabhrao mat! RoadHelp se nearby technicians tak direct connection milta hai.

## Features
- 🆘 SOS Emergency Button
- 📍 Real-time Location Tracking
- 🔧 Nearby Technicians Map
- 💬 Live Chat (Owner ↔ Technician)
- ⭐ Rating System
- 🔔 Real-time Notifications with Socket.io

## Complete Setup

### 1. Backend install karo
```bash
cd backend
npm install
```

### 2. `.env` file banao
`backend/.env` mein ye values dal do:
```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/roadside-assist
JWT_SECRET=roadside_assist_secret_key_2024
CLIENT_URL=http://127.0.0.1:5500
```

> Agar production mein deploy kar rahe ho, toh Atlas ka connection string `MONGO_URI` mein daal do.

### 3. Server start karo
```bash
cd backend
npm start
```

### 4. Browser mein open karo
- Open `http://localhost:5000`
- Backend ab frontend files bhi serve karega

## Deployment Notes
- Frontend aur backend ab same server se serve hota hai.
- `frontend` folder static assets serve ke liye use hota hai.
- Production mein `NODE_ENV=production` set karo aur real MongoDB URI use karo.

### Railway / Render
1. GitHub par code push karo.
2. Railway/Render par new project banayein.
3. Environment variables add karo:
   ```env
   PORT=5000
   MONGO_URI=your-production-mongodb-uri
   JWT_SECRET=your_jwt_secret
   NODE_ENV=production
   ```
4. Deploy karo.

### Docker deploy
Agar Docker use karna hai, use root `Dockerfile` and deploy from Docker.

## Important Files
- `backend/server.js` — Express + Socket.io + static frontend serving
- `frontend/index.html` — Landing page
- `frontend/register.html` — Owner / Technician registration
- `frontend/login.html` — Login page
- `backend/routes/auth.js` — User register/login logic

## Kya ban gaya?
- Frontend aur backend ab ek saath chalte hain
- Browser mein seedha `http://localhost:5000` kholke app use kar sakte ho
- No separate frontend server required

## Useful commands
```bash
cd backend
npm install
npm start
```

## Git ignore
- `backend/node_modules/`
- `backend/.env`
- `.vscode/`
- OS temp files
