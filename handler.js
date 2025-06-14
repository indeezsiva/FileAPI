const serverless = require('serverless-http');
const app = require('./index');

module.exports.handler = serverless(app);

// Start local server only if not running in Lambda
// if (process.env.NODE_ENV !== 'lambda') {
  const PORT = process.env.PORT || 4001;
  app.listen(PORT, () => {
    console.log(`🚀 Server running locally at http://localhost:${PORT}`);
  });
// }