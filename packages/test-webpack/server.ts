const { serveStatic } = require('@hono/node-server/serve-static');
const { Hono } = require('hono');
const { serve } = require('@hono/node-server');

const app = new Hono();

app.use('*', serveStatic({ root: './dist' }))

const server = serve({
  port: 3000,
  hostname: 'localhost',
  fetch: app.fetch,
}, () => {
  console.log(`Server is running on http://localhost:3000`);
})
