
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


const APP_ENV = process.env.APP_ENV;
const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME;
const DYNAMODB_TABLE_USERS = process.env.DYNAMODB_TABLE_USERS;
const DYNAMODB_TABLE_PLAYLISTS = process.env.DYNAMODB_TABLE_PLAYLISTS;
const DYNAMODB_TABLE_PLAYLIST_SAVES = process.env.DYNAMODB_TABLE_PLAYLIST_SAVES;
const DYNAMODB_TABLE_POSTS = process.env.DYNAMODB_TABLE_POSTS;
const DYNAMODB_TABLE_AUDIO = process.env.DYNAMODB_TABLE_AUDIO;

const ENV_AWS_BUCKET_NAME = `${APP_ENV}-${AWS_BUCKET_NAME}`;
const USERS_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_USERS}`;
const PLAYLISTS_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_PLAYLISTS}`;
const PLAYLIST_SAVES_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_PLAYLIST_SAVES}`;
const POSTS_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_POSTS}`;
const AUDIO_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_AUDIO}`;
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

const AUDIO_MIME_TYPES = [
    'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/x-m4a',
    'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wave'
];
app.post('/create-playlist/audio', upload.none(), async (req, res) => {
    try {
        const {
            userId,
            title,
            description = '',
            isPublic = true,
            fileName = '',
            mediaTitlename,
            posttitle = '',
            content = '',

            audioMeta,
            coverImageMeta,

            ...data
        } = req.body;

        // Validations
        if (!userId || !title || title.length > 50 || !mediaTitlename) {
            return res.status(400).json({ error: 'Missing or invalid required fields' });
        }

        const audio = typeof audioMeta === 'string' ? JSON.parse(audioMeta) : audioMeta;
        const coverImage = coverImageMeta ? (typeof coverImageMeta === 'string' ? JSON.parse(coverImageMeta) : coverImageMeta) : null;

        if (!audio?.fileName || !AUDIO_MIME_TYPES.includes(audio.mimeType)) {
            return res.status(400).json({ error: 'Invalid audio metadata' });
        }

        if (coverImage && (!coverImage.fileName || !IMAGE_MIME_TYPES.includes(coverImage.mimeType))) {
            return res.status(400).json({ error: 'Invalid cover image metadata' });
        }


        const userCheck = await dynamo.send(new GetCommand({
            TableName: USERS_TABLE,
            Key: { userId }
        }));
        if (!userCheck.Item) {
            return res.status(404).json({ error: 'User not found' });
        }

        const { Filter } = await import('bad-words');
        const filter = new Filter();
        if (filter.isProfane(posttitle) || filter.isProfane(title) || (content && filter.isProfane(content))) {
            return res.status(400).json({ error: 'Profanity detected in title or description' });
        }

        const now = new Date().toISOString();
        const playlistId = `playlist-${uuidv4()}`;
        const audioId = `audio-${uuidv4()}`;

        // === Upload URLs ===
        const sanitizedAudioName = audio.fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
        const audioS3Key = `${APP_ENV}/public/audio/${audioId}/${sanitizedAudioName}`;

        const audioUploadUrl = s3.getSignedUrl('putObject', {
            Bucket: ENV_AWS_BUCKET_NAME,
            Key: audioS3Key,
            ContentType: audio.mimeType,
            Expires: 300,
        });

        let coverImageUploadUrl = null;
        let coverImageUrl = null;

        if (coverImage) {
            const sanitizedCoverName = coverImage.fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
            const coverS3Key = `${APP_ENV}/public/audio/${audioId}/cover/${sanitizedCoverName}`;
            coverImageUrl = coverS3Key;

            coverImageUploadUrl = s3.getSignedUrl('putObject', {
                Bucket: ENV_AWS_BUCKET_NAME,
                Key: coverS3Key,
                ContentType: coverImage.mimeType,
                Expires: 300
            });
        }

        // === Optional: Playlist Cover Upload URL ===
        let playlistCoverS3Key = '';
        let playlistCoverUploadUrl = '';

        if (fileName) {
            const sanitizedFileName = fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
            playlistCoverS3Key = `${APP_ENV}/playlists/${userId}/${playlistId}/cover/${sanitizedFileName}`;

            playlistCoverUploadUrl = s3.getSignedUrl('putObject', {
                Bucket: ENV_AWS_BUCKET_NAME,
                Key: playlistCoverS3Key,
                ContentType: 'image/jpeg',
                Expires: 300
            });
        }

        // === Save audio metadata ===
        const audioItem = {
            audioId,
            userId,
            title: mediaTitlename,
            fileName: sanitizedAudioName,
            mimeType: audio.mimeType,
            s3Key: audioS3Key,
            mediaUrl: audioS3Key,
            coverImageUrl,
            uploadedAt: now,
            album: data.album || 'unknown',
            artist: data.artist || 'unknown',
            label: data.label || 'unknown',
            duration: data.duration ? Number(data.duration) : null,
            genre: data.genre || 'unknown',
            language: data.language || 'unknown',
            bitrate: data.bitrate ? Number(data.bitrate) : null,
            active: true,
            upload_status: 'pending'
        };

        await dynamo.send(new PutCommand({
            TableName: AUDIO_TABLE,
            Item: audioItem
        }));

        // === Save playlist with 1 track ===
        const track = {
            ...audioItem,
            index: 0,
            ownerId: userId
        };

        const playlistItem = {
            playlistId,
            userId,
            title,
            description,
            coverImage: playlistCoverS3Key || null,
            tracks: [track],
            createdAt: now,
            updatedAt: now,
            followersCount: 0,
            likesCount: 0,
            savedCount: 0,
            isPublic
        };

        await dynamo.send(new PutCommand({
            TableName: PLAYLISTS_TABLE,
            Item: playlistItem
        }));

        return res.status(200).json({
            success: true,
            message: 'Playlist and audio initialized',
            playlistId,
            audioId,
            uploadUrls: {
                audio: { uploadUrl: audioUploadUrl, fileName: sanitizedAudioName },
                ...(coverImageUploadUrl && { coverImage: { uploadUrl: coverImageUploadUrl, fileName: coverImage.fileName } }),
                ...(playlistCoverUploadUrl && { playlistCover: { uploadUrl: playlistCoverUploadUrl, fileName: fileName } })
            },
            playlistData: playlistItem
        });

    } catch (err) {
        console.error('Create playlist and upload audio error:', err);
        return res.status(500).json({ error: 'Failed to create playlist and generate audio upload URL' });
    }
});


app.post('/create', async (req, res) => {
    const { userId, title, description = '', audioIds = [], isPublic = true, fileName = '' } = req.body;

    if (!userId || !title || title.length > 50) {
        return res.status(400).json({ error: 'Invalid title or userId' });
    }

    try {
        const playlistId = 'playlist-' + uuidv4();
        let coverImageS3Key = '';
        let coverUploadUrl = '';

        //  Generate signed upload URL if fileName is provided
        if (fileName) {
            const sanitizedFileName = fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
            coverImageS3Key = `${APP_ENV}/playlists/${userId}/${playlistId}/cover/${sanitizedFileName}`;

            coverUploadUrl = s3.getSignedUrl('putObject', {
                Bucket: ENV_AWS_BUCKET_NAME,
                Key: coverImageS3Key,
                ContentType: 'image/jpeg',
                Expires: 60 * 5,
            });
        }

        // Prepare unique audio tracks only
        const tracks = [];
        const addedPostIds = new Set();

        for (const audioId of audioIds) {
            if (addedPostIds.has(audioId)) continue;

            const postData = await dynamo.send(new GetCommand({
                TableName: AUDIO_TABLE,
                Key: { audioId }
            }));

            const post = postData.Item;

            if (!post || !post.mimeType || !post.mimeType.includes('audio')) continue;

            addedPostIds.add(audioId);
            const newTrack = {
                ...post,
                index: tracks.length,
                ownerId: post.userId
            };

            tracks.push(newTrack);
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
//     const { userId, title, description = '', audioIds = [], isPublic = true } = req.body;
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
//         for (const [i, postId] of audioIds.entries()) {
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




// Add existing track to playlist
app.post('/add-track/:playlistId', async (req, res) => {
    const { userId, audioId } = req.body;
    const { playlistId } = req.params;

    try {
        const [playlistData, audioData] = await Promise.all([
            dynamo.send(new GetCommand({ TableName: PLAYLISTS_TABLE, Key: { playlistId } })),
            dynamo.send(new GetCommand({ TableName: AUDIO_TABLE, Key: { audioId } }))
        ]);

        const playlist = playlistData.Item;
        const audio = audioData.Item;

        if (!playlist || playlist.userId !== userId)
            return res.status(403).json({ error: 'Unauthorized or Playlist not found' });

        if (!audio)
            return res.status(404).json({ error: 'Audio track not found' });

        const alreadyAdded = playlist.tracks?.some(track => track.audioId === audioId);
        if (alreadyAdded)
            return res.status(400).json({ error: 'Track already in playlist' });



        const newTrack = {
            ...audio, // Spread all properties from the audio record
            index: playlist.tracks?.length || 0,
            ownerId: audio.userId // Redundant but can keep for clarity
        };

        playlist.tracks = [...(playlist.tracks || []), newTrack];
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

// Upload /Add new track to playlist
app.post('/upload-track/:playlistId', upload.none(), async (req, res) => {
    try {
        const {
            userId,
            mediaTitlename,
            audioMeta,
            coverImageMeta,
            ...data
        } = req.body;
        const { playlistId } = req.params;

        if (!userId || !playlistId || !mediaTitlename || !audioMeta) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const audio = typeof audioMeta === 'string' ? JSON.parse(audioMeta) : audioMeta;
        const coverImage = coverImageMeta ? (typeof coverImageMeta === 'string' ? JSON.parse(coverImageMeta) : coverImageMeta) : null;

        if (!audio.fileName || !AUDIO_MIME_TYPES.includes(audio.mimeType)) {
            return res.status(400).json({ error: 'Invalid audio metadata' });
        }

        const now = new Date().toISOString();
        const audioId = `audio-${uuidv4()}`;

        // Sanitize file names
        const sanitizedAudioName = audio.fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
        const audioS3Key = `${APP_ENV}/public/audio/${audioId}/${sanitizedAudioName}`;

        const audioUploadUrl = s3.getSignedUrl('putObject', {
            Bucket: ENV_AWS_BUCKET_NAME,
            Key: audioS3Key,
            ContentType: audio.mimeType,
            Expires: 300
        });

        let coverImageUploadUrl = null;
        let coverImageUrl = null;

        if (coverImage) {
            const sanitizedCoverName = coverImage.fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
            const coverS3Key = `${APP_ENV}/public/audio/${audioId}/cover/${sanitizedCoverName}`;
            coverImageUrl = coverS3Key;

            coverImageUploadUrl = s3.getSignedUrl('putObject', {
                Bucket: ENV_AWS_BUCKET_NAME,
                Key: coverS3Key,
                ContentType: coverImage.mimeType,
                Expires: 300
            });
        }

        // Save audio metadata
        const audioItem = {
            audioId,
            userId,
            title: mediaTitlename,
            fileName: sanitizedAudioName,
            mimeType: audio.mimeType,
            s3Key: audioS3Key,
            mediaUrl: audioS3Key,
            coverImageUrl,
            uploadedAt: now,
            album: data.album || 'unknown',
            artist: data.artist || 'unknown',
            label: data.label || 'unknown',
            duration: data.duration ? Number(data.duration) : null,
            genre: data.genre || 'unknown',
            language: data.language || 'unknown',
            bitrate: data.bitrate ? Number(data.bitrate) : null,
            active: true,
            upload_status: 'pending'
        };

        await dynamo.send(new PutCommand({
            TableName: AUDIO_TABLE,
            Item: audioItem
        }));

        // Fetch playlist
        const playlistData = await dynamo.send(new GetCommand({
            TableName: PLAYLISTS_TABLE,
            Key: { playlistId }
        }));

        const playlist = playlistData.Item;
        if (!playlist || playlist.userId !== userId) {
            return res.status(403).json({ error: 'Unauthorized or playlist not found' });
        }

        const alreadyAdded = playlist.tracks?.some(track => track.audioId === audioId);
        if (alreadyAdded) {
            return res.status(400).json({ error: 'Track already in playlist' });
        }

        const newTrack = {
            ...audioItem,
            index: playlist.tracks?.length || 0,
            ownerId: userId
        };

        playlist.tracks = [...(playlist.tracks || []), newTrack];
        playlist.updatedAt = now;

        await dynamo.send(new PutCommand({
            TableName: PLAYLISTS_TABLE,
            Item: playlist
        }));

        return res.status(200).json({
            success: true,
            message: 'Audio metadata saved and added to playlist',
            audioId,
            uploadUrls: {
                audio: { uploadUrl: audioUploadUrl, fileName: sanitizedAudioName },
                ...(coverImageUploadUrl && { coverImage: { uploadUrl: coverImageUploadUrl, fileName: coverImage.fileName } })
            },
            playlistData: playlist
        });

    } catch (err) {
        console.error('Upload and add track error:', err);
        return res.status(500).json({ error: 'Failed to upload and add track to playlist' });
    }
});




const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];


// Edit playlist details
app.put('/edit/:playlistId', async (req, res) => {
    const { playlistId } = req.params;
    const { userId, title, description, fileName, mimeType } = req.body;

    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    try {
        const result = await dynamo.send(new GetCommand({
            TableName: PLAYLISTS_TABLE,
            Key: { playlistId }
        }));

        const playlist = result.Item;
        if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
        if (playlist.userId !== userId) return res.status(403).json({ error: 'Unauthorized' });

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

        let uploadUrl = null;
        let s3Key = null;

        if (fileName && mimeType && IMAGE_MIME_TYPES.includes(mimeType)) {
            const sanitizedName = fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
            s3Key = `${APP_ENV}/playlists/${userId}/${playlistId}/cover/${sanitizedName}`;

            uploadUrl = s3.getSignedUrl('putObject', {
                Bucket: ENV_AWS_BUCKET_NAME,
                Key: s3Key,
                ContentType: mimeType,
                Expires: 300
            });

            updateExpr.push('#cover = :cover');
            exprAttrNames['#cover'] = 'coverImage';
            exprAttrValues[':cover'] = s3Key;
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

        return res.json({
            success: true,
            ...(uploadUrl && { uploadUrl, fileName, s3Key })
        });

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
app.get('/myplaylists', async (req, res) => {
    const { userId, playlistId, limit = 10, lastEvaluatedKey, pageOffset = 0 } = req.query;

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    // Sign playlist
    async function signPlaylist(playlist) {
        if (playlist.coverImage && !playlist.coverImage.startsWith('http')) {
            playlist.coverImage = fileService.getSignedMediaUrl(playlist.coverImage);
        }

        const updatedTracks = await Promise.all(
            (playlist.tracks || []).map(async (track) => {
                if (!track.audioId) return track;

                try {
                    const audioData = await dynamo.send(new GetCommand({
                        TableName: AUDIO_TABLE,
                        Key: { audioId: track.audioId }
                    }));

                    if (!audioData.Item) {
                        console.warn(`Audio not found for audioId: ${track.audioId}`);
                        return track; // fallback
                    }

                    const freshTrack = {
                        ...audioData.Item,
                        index: track.index ?? 0
                    };

                    if (freshTrack.mediaUrl) {
                        freshTrack.mediaUrl = fileService.getSignedMediaUrl(freshTrack.mediaUrl);
                    }

                    if (freshTrack.coverImageUrl) {
                        freshTrack.coverImageUrl = fileService.getSignedMediaUrl(freshTrack.coverImageUrl);
                    }

                    return freshTrack;
                } catch (err) {
                    console.error(`Error fetching audio ${track.audioId}:`, err);
                    return track;
                }
            })
        );

        playlist.tracks = updatedTracks;
        return playlist;
    }

    try {
        if (playlistId) {
            // Fetch specific playlist
            const data = await dynamo.send(new GetCommand({
                TableName: PLAYLISTS_TABLE,
                Key: { playlistId }
            }));
            console.log('Fetched playlist data:', data);
            if (!data.Item) {
                return res.status(404).json({ error: 'Playlist not found' });
            }


            // Check ownership
            if (userId !== data.Item.userId) {
                return res.status(403).json({ error: 'Access denied. You can only access your own playlists.' });
            }

            const playlist = await signPlaylist(data.Item); // ✅ Fix here

            return res.json({ playlist });
        }

        // Step 1: Count total playlists for pagination metadata
        const countResult = await dynamo.send(new QueryCommand({
            TableName: PLAYLISTS_TABLE,
            IndexName: 'userId-index',
            KeyConditionExpression: 'userId = :u',
            ExpressionAttributeValues: { ':u': userId },
            Select: 'COUNT'
        }));

        const totalCount = countResult.Count || 0;
        const totalPages = Math.ceil(totalCount / limit);
        const currentPage = Math.floor(pageOffset / limit) + 1;

        // 🔹 Query paginated playlists
        const queryParams = {
            TableName: PLAYLISTS_TABLE,
            IndexName: 'userId-createdAt-index',
            KeyConditionExpression: 'userId = :u',
            ExpressionAttributeValues: { ':u': userId },
            Limit: Number(limit),
            ScanIndexForward: false,
            ExclusiveStartKey: lastEvaluatedKey
                ? JSON.parse(Buffer.from(lastEvaluatedKey, 'base64').toString())
                : undefined,
        };

        const data = await dynamo.send(new QueryCommand(queryParams));

        // 🔹 Fetch fresh metadata for each playlist
        const playlists = await Promise.all((data.Items || []).map(signPlaylist));

        return res.json({
            success: true,
            playlists,
            pagination: {
                totalCount,
                totalPages,
                currentPage,
                pageSize: Number(limit),
                hasMore: !!data.LastEvaluatedKey,
                lastEvaluatedKey: data.LastEvaluatedKey
                    ? Buffer.from(JSON.stringify(data.LastEvaluatedKey)).toString('base64')
                    : null,
            }
        });

    } catch (err) {
        console.error('Playlist fetch error:', err);
        res.status(500).json({
            error: 'Failed to fetch playlists',
            details: err.message
        });
    }
});



// Get playlists saved by user
app.get('/saved', async (req, res) => {
    const { userId, playlistId } = req.query;

    if (!userId) {
        return res.status(400).json({ error: 'Missing userId' });
    }
    // Shared function to sign a playlist and fetch latest track metadata
    async function signPlaylist(playlist) {
        if (playlist.coverImage && !playlist.coverImage.startsWith('http')) {
            playlist.coverImage = fileService.getSignedMediaUrl(playlist.coverImage);
        }

        const updatedTracks = await Promise.all(
            (playlist.tracks || []).map(async (track) => {
                if (!track.audioId) return track;

                try {
                    const audioData = await dynamo.send(new GetCommand({
                        TableName: AUDIO_TABLE,
                        Key: { audioId: track.audioId }
                    }));

                    if (!audioData.Item) {
                        console.warn(`Audio not found for audioId: ${track.audioId}`);
                        return track;
                    }

                    const freshTrack = {
                        ...audioData.Item,
                        index: track.index ?? 0
                    };

                    if (freshTrack.mediaUrl) {
                        freshTrack.mediaUrl = fileService.getSignedMediaUrl(freshTrack.mediaUrl);
                    }

                    if (freshTrack.coverImageUrl) {
                        freshTrack.coverImageUrl = fileService.getSignedMediaUrl(freshTrack.coverImageUrl);
                    }

                    return freshTrack;
                } catch (err) {
                    console.error(`Error fetching audio ${track.audioId}:`, err);
                    return track;
                }
            })
        );

        playlist.tracks = updatedTracks;
        return playlist;
    }

    try {
        if (playlistId) {
            // Check if user has saved this playlist
            const savedItem = await dynamo.send(new GetCommand({
                TableName: PLAYLIST_SAVES_TABLE,
                Key: { userId, playlistId }
            }));

            if (!savedItem.Item) {
                return res.status(403).json({ error: 'Access denied. Playlist not saved by user.' });
            }

            // Fetch full playlist details
            const data = await dynamo.send(new GetCommand({
                TableName: PLAYLISTS_TABLE,
                Key: { playlistId }
            }));

            if (!data.Item) {
                return res.status(404).json({ error: 'Playlist not found' });
            }

            const playlist = await signPlaylist(data.Item);

            return res.json({ success: true, playlist });
        }

        // Step 1: Get saved playlistIds for the user
        const savedResult = await dynamo.send(new QueryCommand({
            TableName: PLAYLIST_SAVES_TABLE,
            KeyConditionExpression: 'userId = :u',
            ExpressionAttributeValues: { ':u': userId },
            ProjectionExpression: 'playlistId'
        }));

        const playlistIds = savedResult.Items.map(i => i.playlistId);
        if (playlistIds.length === 0) {
            return res.json({
                success: true,
                playlists: [],
                pagination: {
                    totalCount: 0,
                    totalPages: 0,
                    currentPage: 1,
                    pageSize: 0,
                    hasMore: false,
                    lastEvaluatedKey: null
                }
            });
        }

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

        // Step 3: Sign each playlist
        playlists = await Promise.all(playlists.map(signPlaylist));

        return res.json({
            success: true,
            playlists,
            pagination: {
                totalCount: playlists.length,
                totalPages: 1,
                currentPage: 1,
                pageSize: playlists.length,
                hasMore: false,
                lastEvaluatedKey: null
            }
        });

    } catch (err) {
        console.error('Fetch saved playlists error:', err);
        res.status(500).json({
            error: 'Failed to fetch saved playlists',
            details: err.message
        });
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
    const { userId, audioId } = req.body;
    const { playlistId } = req.params;

    try {
        const playlistData = await dynamo.send(
            new GetCommand({ TableName: PLAYLISTS_TABLE, Key: { playlistId } })
        );

        const playlist = playlistData.Item;

        if (!playlist || playlist.userId !== userId)
            return res.status(403).json({ error: 'Unauthorized or Playlist not found' });

        const trackIndex = playlist.tracks.findIndex(track => track.audioId === audioId);
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

function reorderTracksByMap(originalTracks, reorderMap) {
    const toMove = [];
    const remaining = [];

    for (const track of originalTracks) {
        if (reorderMap.hasOwnProperty(track.audioId)) {
            toMove.push({ ...track, newIndex: reorderMap[track.audioId] });
        } else {
            remaining.push({ ...track });
        }
    }

    // Sort tracks that are being moved
    toMove.sort((a, b) => a.newIndex - b.newIndex);

    const result = [];
    let insertIndex = 0;
    let movePtr = 0;

    for (let i = 0; i < originalTracks.length; i++) {
        if (movePtr < toMove.length && toMove[movePtr].newIndex === insertIndex) {
            const { newIndex, ...cleanedTrack } = toMove[movePtr];
            result.push({ ...cleanedTrack, index: insertIndex });
            movePtr++;
        } else if (remaining.length > 0) {
            const next = remaining.shift();
            result.push({ ...next, index: insertIndex });
        }
        insertIndex++;
    }

    return result;
}

// handles reordering tracks in a playlist based on a provided map
app.post('/reorder-tracks', async (req, res) => {
    const { playlistId, reorder } = req.body;

    if (!playlistId || !reorder || typeof reorder !== 'object') {
        return res.status(400).json({ error: 'playlistId and reorder map are required' });
    }

    try {
        // Step 1: Get existing playlist
        const { Item: playlist } = await dynamo.send(new GetCommand({
            TableName: PLAYLISTS_TABLE,
            Key: { playlistId }
        }));

        if (!playlist || !Array.isArray(playlist.tracks)) {
            return res.status(404).json({ error: 'Playlist not found or has no tracks' });
        }

        const originalTracks = playlist.tracks;

        // Step 2: Reorder using map
        const reorderedTracks = reorderTracksByMap(originalTracks, reorder);

        // Step 3: Update in DynamoDB
        await dynamo.send(new UpdateCommand({
            TableName: PLAYLISTS_TABLE,
            Key: { playlistId },
            UpdateExpression: 'SET tracks = :tracks, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':tracks': reorderedTracks,
                ':updatedAt': new Date().toISOString()
            }
        }));

        res.json({ success: true });

    } catch (err) {
        console.error('Failed to reorder tracks:', err);
        res.status(500).json({ error: 'Failed to reorder playlist tracks' });
    }
});




module.exports = app;
