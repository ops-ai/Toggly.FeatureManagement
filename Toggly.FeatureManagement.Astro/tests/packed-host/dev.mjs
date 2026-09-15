import { dev } from 'astro';
const server = await dev({ server: { host: '127.0.0.1', port: Number(process.env.PORT) } });
process.once('SIGTERM', async () => { await server.stop(); process.exit(0); });
