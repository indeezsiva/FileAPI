const express = require('express');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const cors = require('cors');
require('dotenv').config();
const fileService = require('../../aws.service'); // Assuming fileService is in the file directory

const app = express();
app.use(cors());
app.use(express.json());

const ddbClient = new DynamoDBClient({ region: process.env.REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);


const APP_ENV = process.env.APP_ENV;
const DYNAMODB_TABLE_POSTS = process.env.DYNAMODB_TABLE_POSTS;
const DYNAMODB_TABLE_COMMENTS = process.env.DYNAMODB_TABLE_COMMENTS;
const DYNAMODB_TABLE_REACTIONS = process.env.DYNAMODB_TABLE_REACTIONS;
const DYNAMODB_TABLE_USERS_FOLLOWS = process.env.DYNAMODB_TABLE_USERS_FOLLOWS;
const DYNAMODB_TABLE_USERS = process.env.DYNAMODB_TABLE_USERS;
const DYNAMODB_TABLE_IMAGE = process.env.DYNAMODB_TABLE_IMAGE;
const DYNAMODB_TABLE_VIDEO = process.env.DYNAMODB_TABLE_VIDEO;
const DYNAMODB_TABLE_AUDIO = process.env.DYNAMODB_TABLE_AUDIO;
const DYNAMODB_TABLE_PLAYLISTS = process.env.DYNAMODB_TABLE_PLAYLISTS;
const DYNAMODB_TABLE_PLAYLIST_SAVES = process.env.DYNAMODB_TABLE_PLAYLIST_SAVES;


const USERS_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_USERS}`;
const POSTS_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_POSTS}`;
const COMMENTS_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_COMMENTS}`;
const REACTIONS_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_REACTIONS}`;
const USER_FOLLOW_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_USERS_FOLLOWS}`;
const IMAGE_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_IMAGE}`;
const VIDEO_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_VIDEO}`;
const AUDIO_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_AUDIO}`;
const PLAYLISTS_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_PLAYLISTS}`;
const PLAYLIST_SAVES_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_PLAYLIST_SAVES}`;



app.get("/get", (req, res, next) => {
    ``
    return res.status(200).json({
        message: "Hello from path! Health check POST API is working!",
    });
});


async function resolveSignedMediaItems(mediaItems = []) {
    return await Promise.all(mediaItems.map(async (item) => {
        if (item.audioId) {
            const { Item: audio } = await ddbClient.send(new GetCommand({
                TableName: AUDIO_TABLE,
                Key: { audioId: item.audioId }
            })) || {};
            if (audio) {
                return {
                    ...item,
                    audioId: audio.audioId,
                    fileName: audio.fileName,
                    mimeType: audio.mimeType,
                    mediaUrl: fileService.getSignedMediaUrl(audio.mediaUrl),
                    coverImageUrl: audio.coverImageUrl ? fileService.getSignedMediaUrl(audio.coverImageUrl) : null,
                    duration: audio.duration || null,
                    artist: audio.artist || null
                };
            }
        }

        if (item.videoId) {
            const { Item: video } = await ddbClient.send(new GetCommand({
                TableName: VIDEO_TABLE,
                Key: { videoId: item.videoId }
            })) || {};
            if (video) {
                return {
                    ...item,
                    videoId: video.videoId,
                    fileName: video.fileName,
                    mimeType: video.mimeType,
                    mediaUrl: fileService.getSignedMediaUrl(video.mediaUrl),
                    coverImageUrl: video.coverImageUrl ? fileService.getSignedMediaUrl(video.coverImageUrl) : null,
                    duration: video.duration || null,
                    resolution: video.resolution || null,
                };
            }
        }

        if (item.playlistId) {
            const { Item: playlist } = await ddbClient.send(new GetCommand({
                TableName: PLAYLISTS_TABLE,
                Key: { playlistId: item.playlistId }
            })) || {};
            if (playlist) {
                return {
                    ...item,
                    playlistId: playlist.playlistId,
                    title: playlist.title,
                    coverImageUrl: playlist.coverImageUrl ? fileService.getSignedMediaUrl(playlist.coverImageUrl) : null,
                    itemCount: playlist.itemCount || 0,
                };
            }
        }

        // fallback (e.g. text post or corrupted metadata)
        return {
            ...item,
            mediaUrl: item.mediaUrl && !item.mediaUrl.startsWith('http')
                ? fileService.getSignedMediaUrl(item.mediaUrl)
                : item.mediaUrl,
            coverImageUrl: item.coverImageUrl && !item.coverImageUrl.startsWith('http')
                ? fileService.getSignedMediaUrl(item.coverImageUrl)
                : item.coverImageUrl,
        };
    }));
}
// unauthenticated public posts endpoint
app.get('/posts/all', async (req, res) => {
    const { limit = 20, privacy = "public", lastEvaluatedKey, pageOffset = 0 } = req.query;

    try {
        // Step 1: Count total public posts
        const countResult = await docClient.send(new QueryCommand({
            TableName: POSTS_TABLE,
            IndexName: 'privacy-createdAt-index',
            KeyConditionExpression: 'privacy = :p',
            ExpressionAttributeValues: {
                ':p': 'public'
            },
            Select: 'COUNT'
        }));

        const totalCount = countResult.Count || 0;
        const totalPages = Math.ceil(totalCount / limit);
        const currentPage = Math.floor(pageOffset / limit) + 1;

        // Step 2: Paginated query of public posts
        const queryParams = {
            TableName: POSTS_TABLE,
            IndexName: 'privacy-createdAt-index',
            KeyConditionExpression: 'privacy = :p',
            ExpressionAttributeValues: {
                ':p': 'public'
            },
            Limit: Number(limit),
            ScanIndexForward: false,
            ExclusiveStartKey: lastEvaluatedKey
                ? JSON.parse(Buffer.from(lastEvaluatedKey, 'base64').toString())
                : undefined
        };

        const result = await docClient.send(new QueryCommand(queryParams));
        const posts = result.Items || [];

        // Step 3: Enrich each post
        const enhancedPosts = await Promise.all(posts.map(async (post) => {
            const postId = post.postId;

            const commentResult = await docClient.send(new QueryCommand({
                TableName: COMMENTS_TABLE,
                IndexName: 'PostIdIndex',
                KeyConditionExpression: 'postId = :pid',
                ExpressionAttributeValues: { ':pid': postId },
                Select: 'COUNT'
            }));

            const commentsCount = commentResult.Count || 0;

            const reactionResult = await docClient.send(new QueryCommand({
                TableName: REACTIONS_TABLE,
                IndexName: 'PostIdIndex',
                KeyConditionExpression: 'postId = :pid',
                ExpressionAttributeValues: { ':pid': postId }
            }));

            const reactions = reactionResult.Items || [];

            const reactionsCount = reactions.reduce((acc, r) => {
                acc[r.reactionType] = (acc[r.reactionType] || 0) + 1;
                return acc;
            }, {});

            const totalReactions = reactions.length;

            if (post.resourceType === 'text' && !post.mediaItems) {
                post.mediaItems = [];
            }

            const signedMediaItems = await resolveSignedMediaItems(post.mediaItems || []);

            const postedByUserData = await ddbClient.send(new GetCommand({
                TableName: USERS_TABLE,
                Key: { userId: post.userId },
            }));

            if (
                postedByUserData.Item?.avatarUrl &&
                !postedByUserData.Item.avatarUrl.startsWith('http')
            ) {
                postedByUserData.Item.avatarUrl = fileService.getSignedMediaUrl(postedByUserData.Item.avatarUrl);
            }

            const userdata = {
                userId: post.userId,
                firstName: postedByUserData.Item.firstName,
                lastName: postedByUserData.Item.lastName,
                avatarUrl: postedByUserData.Item.avatarUrl,
                email: postedByUserData.Item.email,
                userType: postedByUserData.Item.userType,
            };

            return {
                ...post,
                mediaItems: signedMediaItems,
                commentsCount,
                reactionsCount,
                totalReactions,
                postedBy: userdata
            };
        }));

        // Step 4: Return response
        const response = {
            success: true,
            data: enhancedPosts,
            pagination: {
                totalCount,
                totalPages,
                currentPage,
                pageSize: Number(limit),
                hasMore: !!result.LastEvaluatedKey,
                lastEvaluatedKey: result.LastEvaluatedKey
                    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
                    : null,
            }
        };

        return res.json(response);
    } catch (err) {
        console.error('Post retrieval error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve posts',
            details: err.message
        });
    }
});


// authenticated public posts endpoint
// This endpoint retrieves public posts for a specific user with pagination and counts comments and reactions
app.get('/posts', async (req, res) => {
    const { userId, limit = 20, privacy = "public", lastEvaluatedKey, pageOffset = 0 } = req.query;

    if (!userId) {
        return res.status(400).json({ success: false, error: 'Missing userId' });
    }

    try {
        // Step 1: Validate user
        const userCheck = await ddbClient.send(new GetCommand({
            TableName: USERS_TABLE,
            Key: { userId },
        }));

        if (!userCheck.Item) {
            return res.status(404).json({ success: false, error: 'Invalid userId. User not found.' });
        }

        // Step 2: Count total posts
        const countResult = await docClient.send(new QueryCommand({
            TableName: POSTS_TABLE,
            IndexName: 'privacy-createdAt-index',
            KeyConditionExpression: 'privacy = :p',
            ExpressionAttributeValues: {
                ':p': 'public'
            },
            Select: 'COUNT'
        }));

        const totalCount = countResult.Count || 0;
        const totalPages = Math.ceil(totalCount / limit);
        const currentPage = Math.floor(pageOffset / limit) + 1;

        // Step 3: Query paginated posts
        // const queryParams = {
        //     TableName: POSTS_TABLE,
        //     IndexName: 'userId-createdAt-index',
        //     KeyConditionExpression: 'userId = :uid',
        //     ExpressionAttributeValues: {
        //         ':uid': userId,
        //     },
        //     Limit: Number(limit),
        //     ScanIndexForward: false,
        //     ExclusiveStartKey: lastEvaluatedKey
        //         ? JSON.parse(Buffer.from(lastEvaluatedKey, 'base64').toString())
        //         : undefined
        // };


        const queryParams = {
            TableName: POSTS_TABLE,
            IndexName: 'privacy-createdAt-index',
            KeyConditionExpression: 'privacy = :p',
            ExpressionAttributeValues: {
                ':p': 'public'
            },
            Limit: Number(limit),
            ScanIndexForward: false, // latest first
            ExclusiveStartKey: lastEvaluatedKey
                ? JSON.parse(Buffer.from(lastEvaluatedKey, 'base64').toString())
                : undefined
        };

        const result = await docClient.send(new QueryCommand(queryParams));
        console.log("Count Result 2:", result);

        // const result = await docClient.send(new QueryCommand(queryParams));


        // 1. Paginated posts (already fetched via QueryCommand)
        const posts = result.Items || [];

        // 2. Enhance each post with comments and reactions count
        const enhancedPosts = await Promise.all(posts.map(async (post) => {
            const postId = post.postId;

            const commentParams = {
                TableName: COMMENTS_TABLE,
                IndexName: 'PostIdIndex', // must exist
                KeyConditionExpression: 'postId = :pid',
                ExpressionAttributeValues: { ':pid': postId },
                Select: 'COUNT'
            }
            const commentResult = await docClient.send(new QueryCommand(commentParams));

            // 2.1 Count comments using PostIdIndex
            // const commentResult = await dynamoDb.query().promise();
            const commentsCount = commentResult.Count || 0;

            const reactionsParams = {
                TableName: REACTIONS_TABLE,
                IndexName: 'PostIdIndex',
                KeyConditionExpression: 'postId = :pid',
                ExpressionAttributeValues: {
                    ':pid': postId
                }
            };

            // Fetch all reactions for this postId
            const reactionResult = await docClient.send(new QueryCommand(reactionsParams));

            const reactions = reactionResult.Items || [];

            //  1. Grouped reaction count
            const reactionsCount = reactions.reduce((acc, r) => {
                acc[r.reactionType] = (acc[r.reactionType] || 0) + 1;
                return acc;
            }, {});

            //  2. Total reactions
            const totalReactions = reactions.length;
            //  Ensure mediaItems is at least an empty array for text posts
            if (post.resourceType === 'text' && !post.mediaItems) {
                post.mediaItems = [];
            }
            const signedMediaItems = await resolveSignedMediaItems(post.mediaItems || []);

            const postedByUserData = await ddbClient.send(new GetCommand({
                TableName: USERS_TABLE,
                Key: { userId: post.userId },
            }));
            // Generate pre-signed avatar URL if avatarUrl exists and is an S3 key
            if (postedByUserData.Item.avatarUrl && !postedByUserData.Item.avatarUrl.startsWith('http')) {
                postedByUserData.Item.avatarUrl = fileService.getSignedMediaUrl(postedByUserData.Item.avatarUrl);
            }
            const userdata = {
                userId: post.userId,
                firstName: postedByUserData.Item.firstName,
                lastName: postedByUserData.Item.lastName,
                avatarUrl: postedByUserData.Item.avatarUrl,
                email: postedByUserData.Item.email,
                userType: postedByUserData.Item.userType,
            }
            // 2.5 Return the enriched post
            return {
                ...post,
                mediaItems: signedMediaItems,
                commentsCount,
                reactionsCount,
                totalReactions,
                postedBy: userdata
            };
        }));

        // Step 4: Response with pagination
        const response = {
            success: true,
            data: enhancedPosts || [],
            pagination: {
                totalCount,
                totalPages,
                currentPage,
                pageSize: Number(limit),
                hasMore: !!result.LastEvaluatedKey,
                lastEvaluatedKey: result.LastEvaluatedKey
                    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
                    : null,
            }
        };

        return res.json(response);
    } catch (err) {
        console.error('Post retrieval error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve posts',
            details: err.message
        });
    }
});


app.get('/posts/following', async (req, res) => {
    const {
        userId,
        limit = 50,
        lastEvaluatedKey,
        pageOffset = 0
    } = req.query;

    if (!userId) {
        return res.status(400).json({ success: false, error: 'Missing userId' });
    }

    try {
        // Step 1: Get followed user IDs
        const followResult = await docClient.send(new QueryCommand({
            TableName: USER_FOLLOW_TABLE,
            KeyConditionExpression: 'PK = :pk',
            FilterExpression: 'direction = :dir',
            ExpressionAttributeValues: {
                ':pk': `FOLLOW#${userId}`,
                ':dir': 'following'
            }
        }));

        const followedUserIds = followResult.Items.map(f => f.SK.replace('USER#', ''));

        if (!followedUserIds.length) {
            return res.json({
                success: true,
                data: [],
                pagination: {
                    totalCount: 0,
                    totalPages: 0,
                    currentPage: 1,
                    pageSize: Number(limit),
                    hasMore: false,
                    lastEvaluatedKey: null
                }
            });
        }

        const paginationState = lastEvaluatedKey
            ? JSON.parse(Buffer.from(lastEvaluatedKey, 'base64').toString())
            : {};

        const postsPerUser = Math.ceil(Number(limit) / followedUserIds.length);
        const allPosts = [];
        const nextKeys = {};
        let totalCount = 0;

        // Step 2: Query all posts + count per followed user
        const queryTasks = followedUserIds.map(async uid => {
            // Count total posts for this user
            const countRes = await docClient.send(new QueryCommand({
                TableName: POSTS_TABLE,
                IndexName: 'userId-createdAt-index',
                KeyConditionExpression: 'userId = :uid',
                ExpressionAttributeValues: { ':uid': uid },
                Select: 'COUNT'
            }));
            totalCount += countRes.Count || 0;

            // Fetch paginated posts
            const postQueryParams = {
                TableName: POSTS_TABLE,
                IndexName: 'userId-createdAt-index',
                KeyConditionExpression: 'userId = :uid',
                ExpressionAttributeValues: { ':uid': uid },
                Limit: postsPerUser,
                ScanIndexForward: false
            };

            if (paginationState[uid]) {
                postQueryParams.ExclusiveStartKey = paginationState[uid];
            }

            const result = await docClient.send(new QueryCommand(postQueryParams));
            if (result.Items) allPosts.push(...result.Items);
            if (result.LastEvaluatedKey) nextKeys[uid] = result.LastEvaluatedKey;
        });

        await Promise.all(queryTasks);

        // Step 3: Global sorting and limiting
        allPosts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const paginatedPosts = allPosts.slice(0, Number(limit));

        // Step 4: Prepare pagination meta
        const totalPages = Math.ceil(totalCount / Number(limit));
        const currentPage = Math.floor(pageOffset / limit) + 1;
        const hasMore = Object.keys(nextKeys).length > 0;
        const encodedNextKey = hasMore
            ? Buffer.from(JSON.stringify(nextKeys)).toString('base64')
            : null;

        // Step 5: Enrich posts
        const postIds = paginatedPosts.map(p => p.postId);
        const [commentCounts, reactionData] = await Promise.all([
            batchQueryCounts(COMMENTS_TABLE, 'PostIdIndex', 'postId', postIds),
            batchQueryItems(REACTIONS_TABLE, 'PostIdIndex', 'postId', postIds)
        ]);

        const enrichedPosts = paginatedPosts.map(async post => {
            const commentsCount = commentCounts[post.postId] || 0;
            const reactions = reactionData[post.postId] || [];

            const reactionsCount = reactions.reduce((acc, r) => {
                acc[r.reactionType] = (acc[r.reactionType] || 0) + 1;
                return acc;
            }, {});

            const totalReactions = reactions.length;
            if (post.resourceType === 'text' && !post.mediaItems) {
                post.mediaItems = [];
            }

            const signedMediaItems = (post.mediaItems || []).map(item => {
                const signedItem = { ...item };
                if (item.mediaUrl && !item.mediaUrl.startsWith('http')) {
                    signedItem.mediaUrl = fileService.getSignedMediaUrl(item.mediaUrl);
                }
                if (item.coverImageUrl && !item.coverImageUrl.startsWith('http')) {
                    signedItem.coverImageUrl = fileService.getSignedMediaUrl(item.coverImageUrl);
                }
                return signedItem;
            });

            const postedByUserData = await ddbClient.send(new GetCommand({
                TableName: USERS_TABLE,
<<<<<<< HEAD
                Key: { userId:post.userId },
=======
                Key: { userId: post.userId },
>>>>>>> origin/main
            }));
            const userdata = {
                userId: post.userId,
                firstName: postedByUserData.Item.firstName,
                lastName: postedByUserData.Item.lastName,
                avatarUrl: postedByUserData.Item.avatarUrl,
                email: postedByUserData.Item.email,
                userType: postedByUserData.Item.userType,
            }
            return {
                ...post,
                mediaItems: signedMediaItems,
                commentsCount,
                reactionsCount,
                totalReactions,
                postedBy: userdata
            };
        });

        // Step 6: Return
        return res.json({
            success: true,
            data: enrichedPosts,
            pagination: {
                totalCount,
                totalPages,
                currentPage,
                pageSize: Number(limit),
                hasMore,
                lastEvaluatedKey: encodedNextKey
            }
        });

    } catch (err) {
        console.error('Followers feed error:', err);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch followed user posts',
            details: err.message
        });
    }
});





async function batchQueryCounts(tableName, indexName, keyName, ids) {
    const counts = {};
    await Promise.all(ids.map(async id => {
        const res = await docClient.send(new QueryCommand({
            TableName: tableName,
            IndexName: indexName,
            KeyConditionExpression: `${keyName} = :id`,
            ExpressionAttributeValues: { ':id': id },
            Select: 'COUNT'
        }));
        counts[id] = res.Count || 0;
    }));
    return counts;
}

async function batchQueryItems(tableName, indexName, keyName, ids) {
    const resultMap = {};
    await Promise.all(ids.map(async id => {
        const res = await docClient.send(new QueryCommand({
            TableName: tableName,
            IndexName: indexName,
            KeyConditionExpression: `${keyName} = :id`,
            ExpressionAttributeValues: { ':id': id }
        }));
        resultMap[id] = res.Items || [];
    }));
    return resultMap;
}

module.exports = app;
