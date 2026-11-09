import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { useDb, register, api } from '../helpers.js';
import { createApp } from '../../src/app.js';
const app = createApp();

useDb();

describe('free browser voice demo (shareable link)', () => {
  it('creates a link anyone can use without logging in, and rejects bad tokens', async () => {
    const r = await register({ businessName: 'PixelForge' });
    const agentId = (await api(r.token).get('/api/agents')).body.agents[0]._id;
    const link = (await api(r.token).post(`/api/agents/${agentId}/demo-link`, {})).body;
    expect(link.url).toMatch(/\/talk\/[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(link.expiresInDays).toBe(14);
    const token = link.url.split('/talk/')[1];

    const info = await request(app).get(`/api/demo/${token}`);
    expect(info.status).toBe(200);
    expect(info.body.brand).toBe('PixelForge');

    const open = await request(app).post(`/api/demo/${token}/chat`).send({});
    expect(open.status).toBe(200);
    expect(open.body.reply).toMatch(/PixelForge/);
    const next = await request(app).post(`/api/demo/${token}/chat`).send({ message: 'Sure, what is this about?', state: open.body.state });
    expect(next.status).toBe(200);
    expect(next.body.reply.length).toBeGreaterThan(10);

    const voice = await request(app).post(`/api/demo/${token}/voice`).send({ text: 'Hello there' });
    expect(voice.status).toBe(204); // no ElevenLabs key → the browser speaks it, for free

    expect((await request(app).get('/api/demo/not-a-token')).status).toBeGreaterThanOrEqual(400);
    // the login token can't be used as a demo token
    expect((await request(app).get(`/api/demo/${r.token}`)).status).toBeGreaterThanOrEqual(400);
  });
});
