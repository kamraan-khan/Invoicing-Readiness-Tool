import path from 'path';
import { app as appCore } from './app.js';
import express from 'express';

// Serve static UI locally
appCore.use(express.static('public'));

// ✅ Add a simple health-check API endpoint
appCore.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Server is running fine!',
  });
});

const PORT = process.env.PORT || 3000;
appCore.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
