/** One-command local demo: embedded MongoDB + seeded demo workspace + built UI on http://localhost:4000 */
process.env.USE_IN_MEMORY_DB ??= process.env.MONGO_URI ? 'false' : 'true';
process.env.SEED_DEMO ??= 'true';
// On Render the public URL is provided; locally it's localhost.
process.env.PUBLIC_BASE_URL ??= process.env.RENDER_EXTERNAL_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
process.env.CLIENT_ORIGIN ??= process.env.PUBLIC_BASE_URL;
process.env.AUTH_RATE_LIMIT_PER_15MIN ??= '1000';
process.env.RATE_LIMIT_PER_MINUTE ??= '3000';
await import('../index.js');
