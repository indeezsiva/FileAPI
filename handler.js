const path = require('path');
// Use ENV_FILE if provided, else default to .env
const envPath = '.env';
require('dotenv').config({
  path: require('path').resolve(__dirname,'.env')
});
const serverless = require('serverless-http');
const app = require('./index');

module.exports.handler = serverless(app);

// Start local server only if not running in Lambda
if (process.env.NODE_ENV !== 'lambda') {
  const PORT = process.env.PORT || 4001;
  app.listen(PORT, () => {
    console.log(`🚀 Server running locally at http://localhost:${PORT}`);
    console.log(`🔧 Loaded env file: ${envPath}`);
  });
}
