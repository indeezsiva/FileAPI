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
const commentRoutes = require('./src/posts/comments'); 
const reactionsRoutes = require('./src/posts/reactions'); 
const logRoutes = require('./src/crashlogs/logs'); 
const homePageRoutes = require('./src/home-page/homepage'); 
const playlistsRoutes = require('./src/playlists/playlists'); 
const audioRoutes = require('./src/manage-audio/manage-audio'); 
const videoRoutes = require('./src/manage-video/manage-video'); 
const moderationcheckRoutes = require('./src/moderation-check/moderation-check'); 


// Register routes
app.use('/media', mediaRoutes);
app.use('/file', fileRoutes);
app.use('/user', userRoutes);
app.use('/posts', postRoutes);
app.use('/comments', commentRoutes);
app.use('/reactions', reactionsRoutes);
app.use('/logs', logRoutes);
app.use('/home', homePageRoutes);
app.use('/playlists', playlistsRoutes);
app.use('/audio', audioRoutes);
app.use('/video', videoRoutes);
app.use('/moderation', moderationcheckRoutes);


module.exports = app;
