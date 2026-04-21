import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fetch from 'node-fetch';

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:5000';

// In-memory auth token (set via login tool)
let authToken = process.env.AUTH_TOKEN || null;

function headers(withAuth = true) {
  const h = { 'Content-Type': 'application/json' };
  if (withAuth && authToken) h['Authorization'] = `Bearer ${authToken}`;
  return h;
}

async function apiCall(method, path, body = null, withAuth = true) {
  const opts = { method, headers: headers(withAuth) };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

const server = new McpServer({
  name: 'roadside-assist',
  version: '1.0.0',
});

// ─── AUTH TOOLS ───────────────────────────────────────────────────────────────

server.tool(
  'register',
  'Register a new user (owner or technician)',
  {
    name:         z.string().describe('Full name'),
    email:        z.string().email().describe('Email address'),
    phone:        z.string().describe('Phone number'),
    password:     z.string().min(6).describe('Password (min 6 chars)'),
    role:         z.enum(['owner', 'technician']).describe('User role'),
    skills:       z.array(z.string()).optional().describe('Technician skills e.g. ["puncture","engine"]'),
    vehicleTypes: z.array(z.string()).optional().describe('Vehicle types the technician handles'),
  },
  async ({ name, email, phone, password, role, skills, vehicleTypes }) => {
    const data = await apiCall('POST', '/api/auth/register',
      { name, email, phone, password, role, skills, vehicleTypes }, false);
    authToken = data.token;
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'login',
  'Login with email and password. Stores the JWT token for subsequent calls.',
  {
    email:    z.string().email(),
    password: z.string(),
  },
  async ({ email, password }) => {
    const data = await apiCall('POST', '/api/auth/login', { email, password }, false);
    authToken = data.token;
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'get_me',
  'Get the currently logged-in user profile',
  {},
  async () => {
    const data = await apiCall('GET', '/api/auth/me');
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'set_token',
  'Manually set the Bearer auth token (use if you already have a token)',
  { token: z.string().describe('JWT token') },
  async ({ token }) => {
    authToken = token;
    return { content: [{ type: 'text', text: 'Token set successfully.' }] };
  }
);

server.tool(
  'update_availability',
  'Toggle availability for a technician (true = available for requests)',
  { isAvailable: z.boolean() },
  async ({ isAvailable }) => {
    const data = await apiCall('PATCH', '/api/auth/availability', { isAvailable });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

// ─── TECHNICIAN TOOLS ─────────────────────────────────────────────────────────

server.tool(
  'find_nearby_technicians',
  'Find available technicians near a GPS location',
  {
    lat:    z.number().describe('Latitude'),
    lng:    z.number().describe('Longitude'),
    radius: z.number().optional().default(10).describe('Search radius in km (default 10)'),
  },
  async ({ lat, lng, radius }) => {
    const data = await apiCall('GET', `/api/technicians/nearby?lat=${lat}&lng=${lng}&radius=${radius}`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'get_technician_profile',
  'Get a technician profile by their user ID',
  { id: z.string().describe('Technician user ID') },
  async ({ id }) => {
    const data = await apiCall('GET', `/api/technicians/${id}`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

// ─── REQUEST TOOLS ────────────────────────────────────────────────────────────

server.tool(
  'create_request',
  'Create a new SOS roadside assistance request (owner only)',
  {
    vehicleType:  z.string().describe('e.g. "car", "bike", "truck"'),
    problemType:  z.string().describe('e.g. "puncture", "engine", "battery"'),
    description:  z.string().describe('Short description of the problem'),
    lat:          z.number().describe('Latitude of breakdown location'),
    lng:          z.number().describe('Longitude of breakdown location'),
    address:      z.string().describe('Human-readable address'),
  },
  async ({ vehicleType, problemType, description, lat, lng, address }) => {
    const data = await apiCall('POST', '/api/requests',
      { vehicleType, problemType, description, lat, lng, address });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'get_active_request',
  'Get the current active request for the logged-in user (owner or technician)',
  {},
  async () => {
    const data = await apiCall('GET', '/api/requests/my-active');
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'get_request_history',
  'Get past completed/cancelled requests for the logged-in user',
  {},
  async () => {
    const data = await apiCall('GET', '/api/requests/my-history');
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'get_nearby_requests',
  'Get pending requests near the technician\'s current location',
  {
    lat:    z.number().describe('Technician latitude'),
    lng:    z.number().describe('Technician longitude'),
    radius: z.number().optional().default(15).describe('Radius in km (default 15)'),
  },
  async ({ lat, lng, radius }) => {
    const data = await apiCall('GET',
      `/api/requests/nearby-requests?lat=${lat}&lng=${lng}&radius=${radius}`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'accept_request',
  'Accept a pending assistance request (technician only)',
  { requestId: z.string().describe('Request ID to accept') },
  async ({ requestId }) => {
    const data = await apiCall('PATCH', `/api/requests/${requestId}/accept`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'complete_request',
  'Mark a request as completed and optionally leave a rating (1-5)',
  {
    requestId: z.string().describe('Request ID'),
    rating:    z.number().min(1).max(5).optional().describe('Rating 1-5 (optional)'),
  },
  async ({ requestId, rating }) => {
    const body = rating !== undefined ? { rating } : {};
    const data = await apiCall('PATCH', `/api/requests/${requestId}/complete`, body);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'cancel_request',
  'Cancel an active request (owner only)',
  { requestId: z.string().describe('Request ID to cancel') },
  async ({ requestId }) => {
    const data = await apiCall('PATCH', `/api/requests/${requestId}/cancel`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

// ─── START ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
