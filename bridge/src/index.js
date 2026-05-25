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

// Mount routes (placeholder)
// app.use('/api/room', roomRoutes);
// app.use('/api/distill', distillRoutes);

app.listen(PORT, () => {
  console.log(`Bridge server running on http://localhost:${PORT}`);
});
