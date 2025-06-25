// file.js // not in use
const express = require('express');
const app = express();

// Example route
app.get('/file/ping', (req, res) => {
  res.send('file route is live!');
});

module.exports = app;
