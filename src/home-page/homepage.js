
// posts.js
require('dotenv').config();
const express = require('express');
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const PORT = 4000;
require('dotenv').config();
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./../../swagger');
const app = express();
const multer = require('multer');
const cors = require("cors");
const env = process.env.APP_ENV || 'dev'; // 'dev', 'prod', etc.
const serverless = require('serverless-http');
const fileService = require('./../../aws.service'); // Assuming your multipart upload function is in fileService.js
const upload = multer({ storage: multer.memoryStorage() });


// aws config for aws access
AWS.config.update({
    region: process.env.REGION,
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
});
const s3 = new AWS.S3();

AWS.config.update({ region: process.env.REGION });
const BUCKET = process.env.AWS_BUCKET_NAME;
const dynamoDb = new AWS.DynamoDB.DocumentClient();

const crypto = require('crypto');

// Generate a 32-byte (256-bit) key for AES-256
const key = crypto.randomBytes(32).toString('hex');
console.log('AES Key:', key); // Save this securely
const CryptoJS = require("crypto-js");

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || key; // use .env for prod
const USER_FOLLOW_TABLE = process.env.DYNAMODB_TABLE_USERS_FOLLOWS;

function encryptData(data) {
    const ciphertext = CryptoJS.AES.encrypt(JSON.stringify(data), ENCRYPTION_KEY).toString();
    return ciphertext;
}

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get("/get", (req, res, next) => {
    return res.status(200).json({
        message: "Hello from path! Health check Home API is working getv!",
    });
});


app.get('/', async (req, res) => {
    const { userId, privacy = 'followers', limit = 20, lastEvaluatedKey, resourceType, search } = req.query;
    console.log('Feed request:', { userId, privacy, limit, lastEvaluatedKey, resourceType, search });

    if (!userId) {
        return res.status(400).json({ error: 'Missing userId' });
    }

    try {
        let posts = [];
        let paginationKey = null;

        if (privacy === 'public') {
            // Improved public posts query with proper pagination
            const scanParams = {
                TableName: process.env.DYNAMODB_TABLE_POSTS,
                IndexName: 'privacy-createdAt-index', // Updated
                KeyConditionExpression: 'privacy = :public',
                ExpressionAttributeValues: { ':public': 'public' },
                ScanIndexForward: false, // newest first
                Limit: Number(limit)
            };

            if (lastEvaluatedKey) {
                try {
                    scanParams.ExclusiveStartKey = JSON.parse(lastEvaluatedKey);
                } catch (err) {
                    return res.status(400).json({ error: 'Invalid lastEvaluatedKey' });
                }
            }

            const scanResult = await dynamoDb.scan(scanParams).promise();
            posts = scanResult.Items || [];
            paginationKey = scanResult.LastEvaluatedKey || null;
        } else {
            // Get followed user IDs
            const followResult = await dynamoDb.query({
                TableName: USER_FOLLOW_TABLE,
                KeyConditionExpression: 'PK = :pk',
                FilterExpression: 'direction = :dir',
                ExpressionAttributeValues: {
                    ':pk': `FOLLOW#${userId}`,
                    ':dir': 'following'
                }
            }).promise();

            const followingIds = followResult.Items.map(item => item.SK.replace('USER#', ''));

            if (followingIds.length === 0) {
                return res.json({ success: true, data: [], lastEvaluatedKey: null });
            }

            // Batch process followed users with pagination
            const batchSize = 5; // Number of users to process at once
            const processedPosts = [];
            let processedCount = 0;
            let lastProcessedKey = null;

            while (processedPosts.length < limit && processedCount < followingIds.length) {
                const batchIds = followingIds.slice(processedCount, processedCount + batchSize);
                processedCount += batchSize;

                // Process each user in parallel
                const batchResults = await Promise.all(batchIds.map(async (followedUserId) => {
                    const queryParams = {
                        TableName: process.env.DYNAMODB_TABLE_POSTS,
                        IndexName: 'userId-createdAt-index', // Updated
                        KeyConditionExpression: 'userId = :uid',
                        ExpressionAttributeValues: { ':uid': followedUserId },
                        ScanIndexForward: false, // newest first
                        // Limit: Math.ceil(limit / batchSize) // Distribute limit across batches

                    };



                    if (lastProcessedKey && lastProcessedKey[followedUserId]) {
                        queryParams.ExclusiveStartKey = lastProcessedKey[followedUserId];
                    }

                    const result = await dynamoDb.query(queryParams).promise();

                    // Store the last evaluated key for this user
                    if (result.LastEvaluatedKey) {
                        lastProcessedKey = lastProcessedKey || {};
                        lastProcessedKey[followedUserId] = result.LastEvaluatedKey;
                    }

                    return result.Items || [];
                }));

                // Merge and sort the batch results
                const batchPosts = batchResults.flat();
                batchPosts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                processedPosts.push(...batchPosts);
            }

            // Apply overall limit
            posts = processedPosts.slice(0, Number(limit));

            // Set pagination key if we have more data to process
            if (lastProcessedKey || processedCount < followingIds.length) {
                paginationKey = {
                    lastProcessedKey,
                    processedCount,
                    followingIds
                };
            }
        }

        // Filter by resourceType
        if (resourceType) {
            posts = posts.filter(post => post.resourceType === resourceType);
        }

        // Filter by keyword (title/content)
        if (search) {
            const keyword = search.toLowerCase();
            posts = posts.filter(post =>
                (post.posttitle?.toLowerCase().includes(keyword) || post.content?.toLowerCase().includes(keyword))
            );
        }

        // Enrich posts
        const enrichedPosts = await Promise.all(posts.map(async (post) => {
            const postId = post.postId;

            // Comments count
            const commentResult = await dynamoDb.query({
                TableName: process.env.DYNAMODB_TABLE_COMMENTS,
                IndexName: 'PostIdIndex',
                KeyConditionExpression: 'postId = :pid',
                ExpressionAttributeValues: { ':pid': postId },
                Select: 'COUNT'
            }).promise();
            const commentsCount = commentResult.Count || 0;

            // Reactions count
            const reactionResult = await dynamoDb.scan({
                TableName: process.env.DYNAMODB_TABLE_REACTIONS,
                FilterExpression: 'postId = :pid',
                ExpressionAttributeValues: { ':pid': postId }
            }).promise();

            const reactions = reactionResult.Items || [];
            const reactionsCount = reactions.reduce((acc, r) => {
                acc[r.reactionType] = (acc[r.reactionType] || 0) + 1;
                return acc;
            }, {});
            const totalReactions = Object.values(reactionsCount).reduce((sum, c) => sum + c, 0);

            return {
                ...post,
                commentsCount,
                reactionsCount,
                totalReactions
            };
        }));

        // Final response
        return res.json({
            success: true,
            data: enrichedPosts,
            lastEvaluatedKey: paginationKey ? JSON.stringify(paginationKey) : null
        });

    } catch (err) {
        console.error('Feed error:', err);
        return res.status(500).json({ error: 'Failed to load feed' });
    }
});


// 1st
// app.get('/', async (req, res) => {
//   const { userId, privacy = 'followers', limit = 20, lastEvaluatedKey, resourceType, search } = req.query;
//   console.log('Feed request:', { userId, privacy, limit, lastEvaluatedKey, resourceType, search });

//   if (!userId) {
//     return res.status(400).json({ error: 'Missing userId' });
//   }

//   try {
//     let posts = [];
//     let paginationKey = null;

//     if (privacy === 'public') {
//       const scanParams = {
//         TableName: process.env.DYNAMODB_TABLE_POSTS,
//         Limit: Number(limit)
//       };

//       if (lastEvaluatedKey) {
//         try {
//           scanParams.ExclusiveStartKey = JSON.parse(lastEvaluatedKey);
//         } catch (err) {
//           return res.status(400).json({ error: 'Invalid lastEvaluatedKey' });
//         }
//       }

//       const scanResult = await dynamoDb.scan(scanParams).promise();

//       posts = (scanResult.Items || []).filter(p => p.privacy === 'public');
//       paginationKey = scanResult.LastEvaluatedKey || null;
//     } else {
//       // Get followed user IDs
//       const followResult = await dynamoDb.query({
//         TableName: USER_FOLLOW_TABLE,
//         KeyConditionExpression: 'PK = :pk',
//         FilterExpression: 'direction = :dir',
//         ExpressionAttributeValues: {
//           ':pk': `FOLLOW#${userId}`,
//           ':dir': 'following'
//         }
//       }).promise();

//       const followingIds = followResult.Items.map(item => item.SK.replace('USER#', ''));

//       if (followingIds.length === 0) {
//         return res.json({ success: true, data: [], lastEvaluatedKey: null });
//       }

//       // No native pagination here since we're querying multiple users individually
//       for (const followedUserId of followingIds) {
//         const postQuery = await dynamoDb.query({
//           TableName: process.env.DYNAMODB_TABLE_POSTS,
//           IndexName: 'userId-index',
//           KeyConditionExpression: 'userId = :uid',
//           ExpressionAttributeValues: { ':uid': followedUserId },
//           ScanIndexForward: false // newest first
//         }).promise();

//         // const publicPosts = postQuery.Items?.filter(p => p.privacy === 'public') || [];

//         // returning all the post of the followed user
//         // This is because the privacy mode is handled at the post level, not user level
//         const publicPosts = postQuery.Items || [];
//         posts.push(...publicPosts);
//       }

//       // Sort here because multiple query results are combined
//       posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
//       paginationKey = null; // Manual pagination not supported in this mode
//     }

//     // Filter by resourceType
//     if (resourceType) {
//       posts = posts.filter(post => post.resourceType === resourceType);
//     }

//     // Filter by keyword (title/content)
//     if (search) {
//       const keyword = search.toLowerCase();
//       posts = posts.filter(post =>
//         (post.posttitle?.toLowerCase().includes(keyword) || post.content?.toLowerCase().includes(keyword))
//       );
//     }

//     // Apply limit manually if needed
//     posts = posts.slice(0, Number(limit));

//     // Enrich posts
//     const enrichedPosts = await Promise.all(posts.map(async (post) => {
//       const postId = post.postId;

//       // Comments count
//       const commentResult = await dynamoDb.query({
//         TableName: process.env.DYNAMODB_TABLE_COMMENTS,
//         IndexName: 'PostIdIndex',
//         KeyConditionExpression: 'postId = :pid',
//         ExpressionAttributeValues: { ':pid': postId },
//         Select: 'COUNT'
//       }).promise();
//       const commentsCount = commentResult.Count || 0;

//       // Reactions count
//       const reactionResult = await dynamoDb.scan({
//         TableName: process.env.DYNAMODB_TABLE_REACTIONS,
//         FilterExpression: 'postId = :pid',
//         ExpressionAttributeValues: { ':pid': postId }
//       }).promise();

//       const reactions = reactionResult.Items || [];
//       const reactionsCount = reactions.reduce((acc, r) => {
//         acc[r.reactionType] = (acc[r.reactionType] || 0) + 1;
//         return acc;
//       }, {});
//       const totalReactions = Object.values(reactionsCount).reduce((sum, c) => sum + c, 0);

//       return {
//         ...post,
//         commentsCount,
//         reactionsCount,
//         totalReactions
//       };
//     }));

//     // Final response
//     return res.json({
//       success: true,
//       data: enrichedPosts,
//       lastEvaluatedKey: paginationKey
//     });

//   } catch (err) {
//     console.error('Feed error:', err);
//     return res.status(500).json({ error: 'Failed to load feed' });
//   }
// });


// GET /feed — returns feed based on privacy mode, supports pagination, resourceType, and keyword search
// app.get('/', async (req, res) => {
//   const { userId, privacy = 'followers', limit = 20, lastEvaluatedKey, resourceType, search } = req.query;
//   console.log('Feed request:', { userId, privacy, limit, lastEvaluatedKey, resourceType, search });
//   if (!userId) {
//     return res.status(400).json({ error: 'Missing userId' });
//   }

//   try {
//     let posts = [];

//     if (privacy === 'public') {
//       debugger
//       // Get all public posts
//       const scanParams = {
//         TableName: process.env.DYNAMODB_TABLE_POSTS
//       };

//       if (lastEvaluatedKey) {
//         try {
//           scanParams.ExclusiveStartKey = JSON.parse(lastEvaluatedKey);
//         } catch (err) {
//           return res.status(400).json({ error: 'Invalid lastEvaluatedKey' });
//         }
//       }

//       const scanResult = await dynamoDb.scan(scanParams).promise();
//       posts = (scanResult.Items || []).filter(p => p.privacy === 'public');
//     } else {
//       // Get following users
//       const followResult = await dynamoDb.query({
//         TableName: USER_FOLLOW_TABLE,
//         KeyConditionExpression: 'PK = :pk',
//         FilterExpression: 'direction = :dir',
//         ExpressionAttributeValues: {
//           ':pk': `FOLLOW#${userId}`,
//           ':dir': 'following'
//         }
//       }).promise();

//       const followingIds = followResult.Items.map(item => item.SK.replace('USER#', ''));

//       if (followingIds.length === 0) {
//         return res.json({ success: true, data: [], lastEvaluatedKey: null });
//       }

//       for (const followedUserId of followingIds) {
//         const postQuery = await dynamoDb.query({
//           TableName: process.env.DYNAMODB_TABLE_POSTS,
//           IndexName: 'userId-index',
//           KeyConditionExpression: 'userId = :uid',
//           ExpressionAttributeValues: { ':uid': followedUserId },
//           ScanIndexForward: false
//         }).promise();

//         const publicPosts = postQuery.Items
//         posts.push(...publicPosts);
//       }
//     }

//     // Sort by newest
//     posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

//     // Apply resourceType and keyword filters
//     if (resourceType) {
//       posts = posts.filter(post => post.resourceType === resourceType);
//     }

//     if (search) {
//       const keyword = search.toLowerCase();
//       posts = posts.filter(post =>
//         (post.posttitle?.toLowerCase().includes(keyword) || post.content?.toLowerCase().includes(keyword))
//       );
//     }

//     // Limit results
//     posts = posts.slice(0, Number(limit));

//     // Enrich posts
//     const enrichedPosts = await Promise.all(posts.map(async (post) => {
//       const postId = post.postId;

//       const commentResult = await dynamoDb.query({
//         TableName: process.env.DYNAMODB_TABLE_COMMENTS,
//         IndexName: 'PostIdIndex',
//         KeyConditionExpression: 'postId = :pid',
//         ExpressionAttributeValues: { ':pid': postId },
//         Select: 'COUNT'
//       }).promise();
//       const commentsCount = commentResult.Count || 0;

//       const reactionResult = await dynamoDb.scan({
//         TableName: process.env.DYNAMODB_TABLE_REACTIONS,
//         FilterExpression: 'postId = :pid',
//         ExpressionAttributeValues: { ':pid': postId }
//       }).promise();

//       const reactions = reactionResult.Items || [];
//       const reactionsCount = reactions.reduce((acc, r) => {
//         acc[r.reactionType] = (acc[r.reactionType] || 0) + 1;
//         return acc;
//       }, {});
//       const totalReactions = Object.values(reactionsCount).reduce((sum, c) => sum + c, 0);

//       return {
//         ...post,
//         commentsCount,
//         reactionsCount,
//         totalReactions
//       };
//     }));

//     return res.json({
//       success: true,
//       data: enrichedPosts,
//       lastEvaluatedKey: scanResult.LastEvaluatedKey || null
//     });

//   } catch (err) {
//     console.error('Feed error:', err);
//     return res.status(500).json({ error: 'Failed to load feed' });
//   }
// });


module.exports = app;
