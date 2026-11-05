import { LocalReviewServer } from './server.js';

const port = parseInt(process.env.PORT || '3100', 10);
const host = process.env.HOST || '127.0.0.1';
const repoRoot = process.env.REPO_ROOT || process.cwd();

const server = new LocalReviewServer({ port, host, repoRoot });

server.start().then((info) => {
  console.log(`\n================================================================================`);
  console.log(`⚡ Local Review Server running at http://${info.host}:${info.port}`);
  console.log(`⚡ WebSocket Progress Stream: ws://${info.host}:${info.port}/events/progress`);
  console.log(`⚡ Health Endpoint: http://${info.host}:${info.port}/api/health`);
  console.log(`⚡ Telemetry Stats: http://${info.host}:${info.port}/api/telemetry/stats`);
  console.log(`================================================================================\n`);
}).catch((err: unknown) => {
  console.error(`✖ Server failed to start: ${(err as Error).message}`);
  process.exit(1);
});
