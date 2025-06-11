// file.js
const express = require('express');
const app = express();

// Example route
app.get('/file/ping', (req, res) => {
  res.send('file route is live!');
});

module.exports = app;
