import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

import roomRoutes from './routes/rooms.js';
import distillRoutes from './routes/distill.js';
import distillRolesRoutes from './routes/distillRoles.js';
import completeRoutes from './routes/complete.js';
import suggestRolesRoutes from './routes/suggestRoles.js';
import testToolsRoutes from './routes/test-tools.js';

app.use('/api/room', roomRoutes);
app.use('/api/distill', distillRoutes);
app.use('/api/distill-roles', distillRolesRoutes);
app.use('/api/complete', completeRoutes);
app.use('/api/suggest-roles', suggestRolesRoutes);
app.use('/api/test-tools', testToolsRoutes);

export { app };

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Bridge server running on http://localhost:${PORT}`);
  });
}
