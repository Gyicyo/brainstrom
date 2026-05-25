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
app.use('/api/room', roomRoutes);

// Distill routes will be mounted in Task 7

app.listen(PORT, () => {
  console.log(`Bridge server running on http://localhost:${PORT}`);
});
