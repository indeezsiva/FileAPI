
// playlistRoutes.js
require('dotenv').config();
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand, BatchGetCommand } = require('@aws-sdk/lib-dynamodb');
const app = express();
const cors = require("cors");
const AWS = require('aws-sdk');

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
// Create playlist
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const USERS_TABLE = process.env.DYNAMODB_TABLE_USERS;
const PLAYLISTS_TABLE = process.env.DYNAMODB_TABLE_PLAYLISTS;
const PLAYLIST_SAVES_TABLE = process.env.DYNAMODB_TABLE_PLAYLIST_SAVES;
const POSTS_TABLE = process.env.DYNAMODB_TABLE_POSTS;
const fileService = require('../../aws.service'); // Assuming fileService is in the file directory
const s3 = new AWS.S3();
// aws config for aws access
AWS.config.update({
  region: process.env.REGION,
  accessKeyId: process.env.ACCESS_KEY_ID,
  secretAccessKey: process.env.SECRET_ACCESS_KEY,
});
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get("/get", (req, res, next) => {
    return res.status(200).json({
        message: "Hello from path! Health check PLAYLISTS API is working!",
    });
});

app.post('/create', async (req, res) => {
  const { userId, title, description = '', postIds = [], isPublic = true, fileName = '' } = req.body;

  if (!userId || !title || title.length > 50) {
    return res.status(400).json({ error: 'Invalid title or userId' });
  }

  try {
    const playlistId = 'playlist-' + uuidv4();
    let coverImageS3Key = '';
    let coverUploadUrl = '';

    // ✅ Generate signed upload URL if fileName is provided
    if (fileName) {
      const sanitizedFileName = fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
      coverImageS3Key = `${process.env.APP_ENV}/playlists/${userId}/${playlistId}/cover/${sanitizedFileName}`;

      coverUploadUrl = s3.getSignedUrl('putObject', {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: coverImageS3Key,
        ContentType: 'image/jpeg',
        Expires: 60 * 5,
      });
    }

    // ✅ Prepare unique audio tracks only
    const tracks = [];
    const addedPostIds = new Set();

    for (const postId of postIds) {
      if (addedPostIds.has(postId)) continue; // Skip duplicates
      const postData = await dynamo.send(new GetCommand({
        TableName: POSTS_TABLE,
        Key: { postId }
      }));

      const post = postData.Item;
      if (!post || post.resourceType !== 'audio') continue;

      addedPostIds.add(postId); // Mark as added

      tracks.push({
        postId,
        title: post.posttitle,
        mimeType: post.mediaItems[0].mimeType,
        audioUrl: post.mediaItems[0].s3Key,
        coverUrl: post.mediaItems?.[1]?.s3Key || null,
        index: tracks.length
      });
    }

    const now = new Date().toISOString();
    await dynamo.send(new PutCommand({
      TableName: PLAYLISTS_TABLE,
      Item: {
        playlistId,
        userId,
        title,
        description,
        coverImage: coverImageS3Key,
        tracks,
        createdAt: now,
        updatedAt: now,
        followersCount: 0,
        likesCount: 0,
        savedCount: 0,
        isPublic
      }
    }));

    res.json({
      success: true,
      playlistId,
      coverImageS3Key,
      coverImageUploadUrl: coverUploadUrl
    });

  } catch (err) {
    console.error('Create playlist error:', err);
    res.status(500).json({ error: 'Failed to create playlist' });
  }
});


// app.post('/create', upload.single('file'), async (req, res) => {
//     const { userId, title, description = '', postIds = [], isPublic = true } = req.body;
//     const file = req.file;
//     if (!userId || !title || title.length > 50) {
//         return res.status(400).json({ error: 'Invalid title or userId' });
//     }

//     try {
//         let coverImageUrl = '';
//         const playlistId = 'playlist-' + uuidv4();

//         //  Handle cover image upload (if file is provided)
//         if (file) {
//             const sanitizedFileName = file.originalname.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
//             const s3Key = `${process.env.APP_ENV}/playlists/${userId}/${playlistId}/cover/${sanitizedFileName}`;
//             const uploadResult = await fileService.s3UploadMultiPart({
//                 Key: s3Key,
//                 Body: file.buffer,
//                 ContentType: file.mimetype,
//             });
//             console.log('Cover image uploaded:', uploadResult);
//             coverImageUrl = `${s3Key}`;
//         }

//         // Collect only audio posts
//         const tracks = [];
//         for (const [i, postId] of postIds.entries()) {
//             const postData = await dynamo.send(new GetCommand({
//                 TableName: POSTS_TABLE,
//                 Key: { postId }
//             }));
//             const post = postData.Item;
//             if (!post || post.resourceType !== 'audio') continue;
//             tracks.push({
//                 postId,
//                 title: post.posttitle,
//                 mediaUrl: post.mediaItems[0].mediaUrl,
//                 mimeType: post.mediaItems[0].mimeType,
//                 index: i
//             });
//         }

//         const now = new Date().toISOString();
//         await dynamo.send(new PutCommand({
//             TableName: PLAYLISTS_TABLE,
//             Item: {
//                 playlistId,
//                 userId,
//                 title,
//                 description,
//                 coverImage: coverImageUrl,
//                 tracks,
//                 createdAt: now,
//                 updatedAt: now,
//                 followersCount: 0,
//                 likesCount: 0,
//                 savedCount: 0,
//                 isPublic: isPublic
//             }
//         }));

//         res.json({ success: true, playlistId, coverImage: coverImageUrl });
//     } catch (err) {
//         console.error('Create playlist error', err);
//         res.status(500).json({ error: 'Failed to create playlist' });
//     }
// });


// Add track to playlist
app.post('/add-track/:playlistId', async (req, res) => {
    const { userId, postId } = req.body;
    const { playlistId } = req.params;

    try {
        const [playlistData, postData] = await Promise.all([
            dynamo.send(new GetCommand({ TableName: PLAYLISTS_TABLE, Key: { playlistId } })),
            dynamo.send(new GetCommand({ TableName: POSTS_TABLE, Key: { postId } }))
        ]);

        const playlist = playlistData.Item;
        const post = postData.Item;

        if (!playlist || playlist.userId !== userId)
            return res.status(403).json({ error: 'Unauthorized or Playlist not found' });

        if (!post || post.resourceType !== 'audio')
            return res.status(400).json({ error: 'Post must be an audio type' });

        const alreadyAdded = playlist.tracks.some(track => track.postId === postId);
        if (alreadyAdded)
            return res.status(400).json({ error: 'Post already exists in playlist' });

        const audioItem = post.mediaItems.find(item => item.index === 0 && item.mimeType.startsWith('audio/'));
        const coverItem = post.mediaItems.find(item => item.index === 1 && item.mimeType.startsWith('image/'));

        if (!audioItem)
            return res.status(400).json({ error: 'Audio file not found in post' });

        playlist.tracks.push({
            postId,
            title: post.posttitle,
            mimeType: audioItem.mimeType,
            audioUrl: audioItem.s3Key,
            coverUrl: coverItem?.s3Key || null,
            index: playlist.tracks.length,
            ownerId: post.userId
        });

        playlist.updatedAt = new Date().toISOString();

        await dynamo.send(new PutCommand({
            TableName: PLAYLISTS_TABLE,
            Item: playlist
        }));

        res.json({ success: true });
    } catch (err) {
        console.error('Add track error:', err);
        res.status(500).json({ error: 'Failed to add track' });
    }
});



// Edit playlist details
app.put('/edit/:playlistId', upload.single('file'), async (req, res) => {
    const { playlistId } = req.params;
    const { userId, title, description } = req.body;
    const file = req.file;

    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    try {
        const result = await dynamo.send(new GetCommand({
            TableName: PLAYLISTS_TABLE,
            Key: { playlistId }
        }));

        const playlist = result.Item;
        if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
        if (playlist.userId !== userId) return res.status(403).json({ error: 'Unauthorized' });

        // Prepare dynamic updates
        const updateExpr = [];
        const exprAttrNames = {};
        const exprAttrValues = {};

        if (title) {
            updateExpr.push('#title = :title');
            exprAttrNames['#title'] = 'title';
            exprAttrValues[':title'] = title;
        }

        if (description) {
            updateExpr.push('#desc = :desc');
            exprAttrNames['#desc'] = 'description';
            exprAttrValues[':desc'] = description;
        }

        if (file) {
            const sanitizedName = file.originalname.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
            const newS3Key = `${process.env.APP_ENV}/playlists/${userId}/${playlistId}/cover/${sanitizedName}`;

            const uploadResult = await fileService.s3UploadMultiPart({
                Key: newS3Key,
                Body: file.buffer,
                ContentType: file.mimetype
            });
            console.log(' Cover image uploaded:', uploadResult);

            updateExpr.push('#cover = :cover');
            exprAttrNames['#cover'] = 'coverImage';
            exprAttrValues[':cover'] = newS3Key;
        }

        updateExpr.push('#updatedAt = :updatedAt');
        exprAttrNames['#updatedAt'] = 'updatedAt';
        exprAttrValues[':updatedAt'] = new Date().toISOString();

        if (updateExpr.length === 1) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        await dynamo.send(new UpdateCommand({
            TableName: PLAYLISTS_TABLE,
            Key: { playlistId },
            UpdateExpression: `SET ${updateExpr.join(', ')}`,
            ExpressionAttributeNames: exprAttrNames,
            ExpressionAttributeValues: exprAttrValues
        }));

        res.json({ success: true });
    } catch (err) {
        console.error('Edit playlist error:', err);
        res.status(500).json({ error: 'Failed to update playlist' });
    }
});

// Save playlist
app.post('/save/:playlistId/', async (req, res) => {
    const { playlistId } = req.params;
    const { userId } = req.body;

    try {
        // 1. Check if already saved
        const existing = await dynamo.send(new GetCommand({
            TableName: PLAYLIST_SAVES_TABLE,
            Key: { userId, playlistId }
        }));

        if (existing.Item) {
            return res.status(400).json({ error: 'Playlist already saved by this user' });
        }

        // 2. Save and increment count
        await dynamo.send(new PutCommand({
            TableName: PLAYLIST_SAVES_TABLE,
            Item: { userId, playlistId, savedAt: new Date().toISOString() }
        }));

        await dynamo.send(new UpdateCommand({
            TableName: PLAYLISTS_TABLE,
            Key: { playlistId },
            UpdateExpression: 'ADD savedCount :incr',
            ExpressionAttributeValues: { ':incr': 1 }
        }));

        res.json({ success: true });
    } catch (err) {
        console.error('Save playlist error:', err);
        res.status(500).json({ error: 'Failed to save playlist' });
    }
});


// Unsave playlist
app.post('/remove-saved/:playlistId', async (req, res) => {
    const { playlistId } = req.params;
    const { userId } = req.body;

    try {
        // 1. Check if not saved
        const existing = await dynamo.send(new GetCommand({
            TableName: PLAYLIST_SAVES_TABLE,
            Key: { userId, playlistId }
        }));

        if (!existing.Item) {
            return res.status(400).json({ error: 'Playlist not saved yet' });
        }

        // 2. Remove and decrement count
        await dynamo.send(new DeleteCommand({
            TableName: PLAYLIST_SAVES_TABLE,
            Key: { userId, playlistId }
        }));

        await dynamo.send(new UpdateCommand({
            TableName: PLAYLISTS_TABLE,
            Key: { playlistId },
            UpdateExpression: 'ADD savedCount :decr',
            ExpressionAttributeValues: { ':decr': -1 }
        }));

        res.json({ success: true });
    } catch (err) {
        console.error('Unsave playlist error:', err);
        res.status(500).json({ error: 'Failed to unsave playlist' });
    }
});


// Get user's created playlists
app.get('/', async (req, res) => {
    const { userId, playlistId } = req.query;

    try {
        if (playlistId) {
            //  Fetch specific playlist by playlistId
            const data = await dynamo.send(new GetCommand({
                TableName: PLAYLISTS_TABLE,
                Key: { playlistId }
            }));

            if (!data.Item) return res.status(404).json({ error: 'Playlist not found' });

            const playlist = data.Item;

            //  Convert coverImage to signed URL
            if (playlist.coverImage && !playlist.coverImage.startsWith('http')) {
                playlist.coverImage = fileService.getSignedMediaUrl(playlist.coverImage);
            }

            //  Sign track URLs
            playlist.tracks = (playlist.tracks || []).map(track => {
                const updatedTrack = { ...track };
                if (track.audioUrl) updatedTrack.audioUrl = fileService.getSignedMediaUrl(track.audioUrl);
                if (track.coverUrl) updatedTrack.coverUrl = fileService.getSignedMediaUrl(track.coverUrl);
                return updatedTrack;
            });

            return res.json({ playlist });
        }

        //  Otherwise, fetch all playlists for userId
        const data = await dynamo.send(new QueryCommand({
            TableName: PLAYLISTS_TABLE,
            IndexName: 'userId-index',
            KeyConditionExpression: 'userId = :u',
            ExpressionAttributeValues: { ':u': userId }
        }));

        const playlists = (data.Items || []).map(playlist => {
            if (playlist.coverImage && !playlist.coverImage.startsWith('http')) {
                playlist.coverImage = fileService.getSignedMediaUrl(playlist.coverImage);
            }

            playlist.tracks = (playlist.tracks || []).map(track => {
                const updatedTrack = { ...track };
                if (track.audioUrl) updatedTrack.audioUrl = fileService.getSignedMediaUrl(track.audioUrl);
                if (track.coverUrl) updatedTrack.coverUrl = fileService.getSignedMediaUrl(track.coverUrl);
                return updatedTrack;
            });

            return playlist;
        });

        res.json({ playlists });

    } catch (err) {
        console.error('Playlist fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch playlists' });
    }
});




// Get playlists saved by user

app.get('/saved', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    try {
        // Step 1: Get saved playlistIds for the user
        const savedResult = await dynamo.send(new QueryCommand({
            TableName: PLAYLIST_SAVES_TABLE,
            KeyConditionExpression: 'userId = :u',
            ExpressionAttributeValues: { ':u': userId },
            ProjectionExpression: 'playlistId'
        }));

        const playlistIds = savedResult.Items.map(i => i.playlistId);
        if (playlistIds.length === 0) return res.json({ playlists: [] });

        // Step 2: Batch get full playlist details
        const batchKeys = playlistIds.map(id => ({ playlistId: id }));
        const batchResult = await dynamo.send(new BatchGetCommand({
            RequestItems: {
                [PLAYLISTS_TABLE]: {
                    Keys: batchKeys
                }
            }
        }));

        let playlists = batchResult.Responses[PLAYLISTS_TABLE] || [];

        // Step 3: Add signed URLs (coverImage, audioUrl, coverUrl)
        playlists = playlists.map(playlist => {
            if (playlist.coverImage && !playlist.coverImage.startsWith('http')) {
                playlist.coverImage = fileService.getSignedMediaUrl(playlist.coverImage);
            }

            playlist.tracks = (playlist.tracks || []).map(track => ({
                ...track,
                audioUrl: track.audioUrl?.startsWith('http') ? track.audioUrl : fileService.getSignedMediaUrl(track.audioUrl),
                coverUrl: track.coverUrl?.startsWith('http') ? track.coverUrl : fileService.getSignedMediaUrl(track.coverUrl)
            }));

            return playlist;
        });

        res.json({ playlists });
    } catch (err) {
        console.error('Fetch saved playlists error:', err);
        res.status(500).json({ error: 'Failed to fetch saved playlists' });
    }
});

app.get('/followers/:playlistId', async (req, res) => {
  const { playlistId } = req.params;

  try {
    // Step 1: Get follower userIds from saves table
    const result = await dynamo.send(new QueryCommand({
      TableName: PLAYLIST_SAVES_TABLE,
      IndexName: 'playlistId-index',
      KeyConditionExpression: 'playlistId = :pid',
      ExpressionAttributeValues: { ':pid': playlistId }
    }));

    const followers = result.Items || [];

    // Step 2: Fetch basic user metadata for each follower
    const users = await Promise.all(
      followers.map(async ({ userId }) => {
        const userRes = await dynamo.send(new GetCommand({
          TableName: USERS_TABLE,
          Key: { userId }
        }));
        const user = userRes.Item;
        if (!user) return null;

        return {
          userId: user.userId,
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          avatarUrl: user.avatarUrl,
          bio: user.bio,
          userType: user.userType
        };
      })
    );

    const validUsers = users.filter(Boolean); // Remove nulls

    res.json({ success: true, count: validUsers.length, followers: validUsers });
  } catch (err) {
    console.error('Fetch playlist followers error:', err);
    res.status(500).json({ error: 'Failed to fetch playlist followers' });
  }
});




app.delete('/:playlistId', async (req, res) => {
    const { userId } = req.body;
    const { playlistId } = req.params;

    try {
        // Fetch playlist
        const playlistData = await dynamo.send(
            new GetCommand({ TableName: PLAYLISTS_TABLE, Key: { playlistId } })
        );

        const playlist = playlistData.Item;

        if (!playlist || playlist.userId !== userId) {
            return res.status(403).json({ error: 'Unauthorized or playlist not found' });
        }

        // Optionally delete cover image from S3 if `coverImageS3Key` exists
        if (playlist.coverImageS3Key) {
            await fileService.s3DeleteObject({ Key: playlist.coverImageS3Key });
        }

        // Delete playlist from DynamoDB
        await dynamo.send(
            new DeleteCommand({ TableName: PLAYLISTS_TABLE, Key: { playlistId } })
        );

        // Optionally delete saved relationships
        if (PLAYLIST_SAVES_TABLE) {
            // Use BatchWrite or Scan+Delete if needed (based on your save model)
        }

        res.json({ success: true, message: 'Playlist deleted successfully' });
    } catch (err) {
        console.error('Delete playlist error:', err);
        res.status(500).json({ error: 'Failed to delete playlist' });
    }
});


app.delete('/remove-track/:playlistId', async (req, res) => {
    const { userId, postId } = req.body;
    const { playlistId } = req.params;

    try {
        const playlistData = await dynamo.send(
            new GetCommand({ TableName: PLAYLISTS_TABLE, Key: { playlistId } })
        );

        const playlist = playlistData.Item;

        if (!playlist || playlist.userId !== userId)
            return res.status(403).json({ error: 'Unauthorized or Playlist not found' });

        const trackIndex = playlist.tracks.findIndex(track => track.postId === postId);
        if (trackIndex === -1)
            return res.status(404).json({ error: 'Track not found in playlist' });

        playlist.tracks.splice(trackIndex, 1);

        // Re-index tracks to maintain correct order
        playlist.tracks = playlist.tracks.map((t, i) => ({ ...t, index: i }));

        playlist.updatedAt = new Date().toISOString();

        await dynamo.send(new PutCommand({
            TableName: PLAYLISTS_TABLE,
            Item: playlist
        }));

        res.json({ success: true });
    } catch (err) {
        console.error('Remove track error:', err);
        res.status(500).json({ error: 'Failed to remove track' });
    }
});



module.exports = app;
