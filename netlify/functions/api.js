const serverless = require('serverless-http');

exports.handler = async (event, context) => {
  const mod = await import('../../src/app.js');
  const app = mod.app;
  const handler = serverless(app);
  return handler(event, context);
};
