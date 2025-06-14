// index.js
const express = require('express');
const app = express();
const cors = require('cors');

app.use(cors());
app.use(express.json());

// Route imports
const mediaRoutes = require('./media');
const fileRoutes = require('./file'); // new file
const userRoutes = require('./UserData'); 

// Register routes
app.use('/media', mediaRoutes);
app.use('/file', fileRoutes);
app.use('/user', userRoutes);

module.exports = app;
