import { defineConfig } from 'vite';

// The Node backend (server/start.js) isn't prefixed under /api — its REST routes live directly
// at /campaigns, /campaigns/:id, etc. (see server/server.js). Rather than adding a prefix to the
// "carried over as-is" backend just to make dev proxying tidy, proxy the one real top-level
// resource path it currently exposes. Extend this list as new resource paths are added.
// WebSocket: the server upgrades any path on its http.Server (no path filtering — see
// server/websocket.js), so /ws is just the path the frontend's ws-client picks to connect through.
export default defineConfig({
  server: {
    proxy: {
      '/campaigns': 'http://localhost:4000',
      '/ws': { target: 'ws://localhost:4000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
  },
});
