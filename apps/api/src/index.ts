import { healthResponseSchema } from '@timmy/contracts';
import { Hono } from 'hono';

const app = new Hono();

app.get('/api/bench/v1/health', context => {
  return context.json(healthResponseSchema.parse({ status: 'ok' }));
});

export default app;
