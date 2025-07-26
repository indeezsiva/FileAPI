const path = require('path');
const dotenv = require('dotenv');
const serverless = require('serverless-http');
const app = require('./index');

// Load environment variables from .env file
const envPath = path.resolve(__dirname, '.env');
dotenv.config({ path: envPath });

module.exports.handler = serverless(app);

// Run local server only if not in Lambda environment
if (process.env.NODE_ENV !== 'lambda') {
  const PORT = process.env.PORT || 4001;
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`✅ Loaded environment variables from: ${envPath}`);
  });
}
