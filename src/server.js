import path from 'path';
import express from 'express';
import { app as appCore } from './app.js';

// Serve static UI locally
appCore.use(express.static('public'));

// ✅ Use Render's dynamic port
const PORT = process.env.PORT || 10000;

appCore.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
