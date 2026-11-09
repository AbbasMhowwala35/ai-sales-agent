import { demoRouter } from './routes/demo.js';
import { assistRouter } from './routes/assist.js';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import path from 'node:path';
import fs from 'node:fs';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { sanitizeRequest } from './lib/sanitize.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './routes/auth.js';
import { businessRouter } from './routes/business.js';
import { teamRouter } from './routes/team.js';
import { knowledgeRouter } from './routes/knowledge.js';
import { leadgenRouter } from './routes/leadgen.js';
import { leadsRouter } from './routes/leads.js';
import { agentsRouter } from './routes/agents.js';
import { campaignsRouter } from './routes/campaigns.js';
import { callsRouter, mediaRouter } from './routes/calls.js';
import { webhooksRouter } from './routes/webhooks.js';
import { analyticsRouter, notificationsRouter, complianceRouter, systemRouter } from './routes/misc.js';
import mongoose from 'mongoose';
import { reportsRouter } from './routes/reports.js';
import { integrationsRouter } from './routes/integrations.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: env.isProd ? undefined : false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: env.CLIENT_ORIGIN.split(','), credentials: true }));
  app.use(compression());
  if (!env.isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 ? 'up' : 'down', time: new Date().toISOString() }));

  // Webhooks first: provider-specific body parsing + signature verification, no JWT
  app.use('/api/webhooks', webhooksRouter);
  app.use('/api/media', mediaRouter);

  app.use(express.json({ limit: '2mb' }));
  app.use(sanitizeRequest);

  const limiter = rateLimit({ windowMs: 60_000, limit: env.RATE_LIMIT_PER_MINUTE, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down.' } } });
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: env.AUTH_RATE_LIMIT_PER_15MIN, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again in a few minutes.' } } });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
  app.use('/api', limiter);

  app.use('/api/auth', authRouter);
  app.use('/api/integrations', integrationsRouter);
  const api = express.Router();
  api.use('/demo', demoRouter); // public, token-scoped voice demo (before auth)
  api.use(requireAuth);
  api.use('/business', businessRouter);
  api.use('/team', teamRouter);
  api.use('/knowledge', knowledgeRouter);
  api.use('/lead-generation', leadgenRouter);
  api.use('/leads', leadsRouter);
  api.use('/agents', agentsRouter);
  api.use('/campaigns', campaignsRouter);
  api.use('/calls', callsRouter);
  api.use('/analytics', analyticsRouter);
  api.use('/notifications', notificationsRouter);
  api.use('/compliance', complianceRouter);
  api.use('/system', systemRouter);
  api.use('/reports', reportsRouter);
  api.use('/assist', assistRouter);
  app.use('/api', api);
  app.use('/api', notFoundHandler);

  // Serve the built SPA in production
  const clientDist = path.resolve(process.cwd(), '../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
