import { createServer } from '../server/api.js';

// Catch anything that would cause a silent exit
process.on('uncaughtException', (err) => {
  console.error('\n[gitnexus serve] Uncaught exception:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
process.on('unhandledRejection', (reason: any) => {
  console.error('\n[gitnexus serve] Unhandled rejection:', reason?.message || reason);
  if (process.env.DEBUG) console.error(reason?.stack);
  process.exit(1);
});

export const resolveServeOptions = (options?: { port?: string; host?: string }) => {
  const port = Number(options?.port ?? process.env.PORT ?? 4747);
  // Default to 'localhost' so the OS decides whether to bind to 127.0.0.1 or
  // ::1 based on system configuration, avoiding spurious CORS errors when the
  // hosted frontend at gitnexus.vercel.app connects to localhost. Hosted
  // platforms such as Zeabur provide PORT and expect 0.0.0.0 binding.
  const host = options?.host ?? (process.env.PORT ? '0.0.0.0' : 'localhost');

  return { port, host };
};

export const serveCommand = async (options?: { port?: string; host?: string }) => {
  const { port, host } = resolveServeOptions(options);

  try {
    await createServer(port, host);
  } catch (err: any) {
    console.error(`\nFailed to start GitNexus server:\n`);
    console.error(`  ${err.message || err}\n`);
    if (err.code === 'EADDRINUSE') {
      console.error(`  Port ${port} is already in use. Either:`);
      console.error(`    1. Stop the other process using port ${port}`);
      console.error(`    2. Use a different port: gitnexus serve --port 4748\n`);
    }
    if (err.stack && process.env.DEBUG) {
      console.error(err.stack);
    }
    process.exit(1);
  }
};
