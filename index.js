// index.js
const express = require('express');
const app = express();
const cors = require('cors');

app.use(cors());
app.use(express.json());

// Route imports
const mediaRoutes = require('./media');
const fileRoutes = require('./file'); // new file
const userRoutes = require('./src/users/UserData'); 
const postRoutes = require('./src/posts/posts'); 
const logRoutes = require('./src/crashlogs/logs'); 


// Register routes
app.use('/media', mediaRoutes);
app.use('/file', fileRoutes);
app.use('/user', userRoutes);
app.use('/posts', postRoutes);
app.use('/logs', logRoutes);


module.exports = app;
