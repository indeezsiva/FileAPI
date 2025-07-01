const express = require('express');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const ddbClient = new DynamoDBClient({ region: process.env.REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);

const POSTS_TABLE = process.env.DYNAMODB_TABLE_POSTS;
const COMMENTS_TABLE = process.env.DYNAMODB_TABLE_COMMENTS;
const REACTIONS_TABLE = process.env.DYNAMODB_TABLE_REACTIONS;
const USER_FOLLOW_TABLE = process.env.DYNAMODB_TABLE_USERS_FOLLOWS;



app.get("/get", (req, res, next) => {
    return res.status(200).json({
        message: "Hello from path! Health check POST API is working!",
    });
});
app.get('/', async (req, res) => {
    const { userId, limit = 10, lastEvaluatedKey } = req.query;
    if (!userId) {
        return res.status(400).json({ success: false, error: 'Missing userId' });
    }

    try {
        // Step 1: Get list of followed users
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
            return res.json({ success: true, data: [], lastEvaluatedKey: null, hasMore: false });
        }

        // Step 2: Fetch posts from all followed users with pagination
        const postsPerUser = Math.ceil(Number(limit) / followedUserIds.length);
        let allPosts = [];
        let lastEvaluatedKeys = {};

        const postPromises = followedUserIds.map(uid => {
            const queryParams = {
                TableName: POSTS_TABLE,
                IndexName: 'userId-index',
                KeyConditionExpression: 'userId = :uid',
                ExpressionAttributeValues: { ':uid': uid },
                Limit: postsPerUser,
                ScanIndexForward: false
            };

            // Apply pagination token if available for this user
            if (lastEvaluatedKey) {
                const parsedKey = JSON.parse(lastEvaluatedKey);
                if (parsedKey[uid]) {
                    queryParams.ExclusiveStartKey = parsedKey[uid];
                }
            }

            return docClient.send(new QueryCommand(queryParams));
        });

        const postResults = await Promise.all(postPromises);

        // Process results and track pagination state
        postResults.forEach((result, index) => {
            const uid = followedUserIds[index];
            if (result.Items) {
                allPosts = allPosts.concat(result.Items);
            }
            if (result.LastEvaluatedKey) {
                lastEvaluatedKeys[uid] = result.LastEvaluatedKey;
            }
        });

        // Sort all posts by date
        allPosts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // Apply global limit
        const paginatedPosts = allPosts.slice(0, Number(limit));

        // Determine if there are more results
        const hasMore = Object.keys(lastEvaluatedKeys).length > 0 || allPosts.length > Number(limit);

        // Prepare next pagination token if needed
        const nextKey = hasMore ? JSON.stringify(lastEvaluatedKeys) : null;

        // Step 3: Enrich with comment & reaction counts (optimized batch approach)
        const postIds = paginatedPosts.map(p => p.postId);

        const [commentCounts, reactionData] = await Promise.all([
            batchQueryCounts(COMMENTS_TABLE, 'PostIdIndex', 'postId', postIds),
            batchQueryItems(REACTIONS_TABLE, 'postId-index', 'postId', postIds)
        ]);

        const enrichedPosts = paginatedPosts.map((post) => {
            const commentsCount = commentCounts[post.postId] || 0;
            const reactions = reactionData[post.postId] || [];

            const reactionsCount = reactions.reduce((acc, r) => {
                acc[r.reactionType] = (acc[r.reactionType] || 0) + 1;
                return acc;
            }, {});

            const totalReactions = Object.values(reactionsCount).reduce((sum, val) => sum + val, 0);

            return {
                ...post,
                commentsCount,
                reactionsCount,
                totalReactions
            };
        });

        return res.json({
            success: true,
            data: enrichedPosts,
            lastEvaluatedKey: nextKey,
            hasMore
        });
    } catch (err) {
        console.error('Feed error:', err);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

// Helper function for batch counting
async function batchQueryCounts(tableName, indexName, keyName, values) {
    const results = await Promise.all(values.map(value =>
        docClient.send(new QueryCommand({
            TableName: tableName,
            IndexName: indexName,
            KeyConditionExpression: `${keyName} = :val`,
            ExpressionAttributeValues: { ':val': value },
            Select: 'COUNT'
        }))
    ));

    const counts = {};
    values.forEach((value, index) => {
        counts[value] = results[index]?.Count || 0;
    });
    return counts;
}

// Helper function for batch querying items
async function batchQueryItems(tableName, indexName, keyName, values) {
    const results = await Promise.all(values.map(value =>
        docClient.send(new QueryCommand({
            TableName: tableName,
            IndexName: indexName,
            KeyConditionExpression: `${keyName} = :val`,
            ExpressionAttributeValues: { ':val': value }
        }))
    ));

    const items = {};
    values.forEach((value, index) => {
        items[value] = results[index]?.Items || [];
    });
    return items;
}


app.get('/posts', async (req, res) => {
    const { userId, limit = 10, lastEvaluatedKey, pageOffset = 0 } = req.query;

    if (!userId) {
        return res.status(400).json({ success: false, error: 'Missing userId' });
    }

    try {
        // Step 1: Validate user
        const userCheck = await ddbClient.send(new GetCommand({
            TableName: process.env.DYNAMODB_TABLE_USERS,
            Key: { userId },
        }));

        if (!userCheck.Item) {
            return res.status(404).json({ success: false, error: 'Invalid userId. User not found.' });
        }

        // Step 2: Count total posts by user
        const countResult = await docClient.send(new QueryCommand({
            TableName: process.env.DYNAMODB_TABLE_POSTS,
            IndexName: 'userId-createdAt-index',
            KeyConditionExpression: 'userId = :uid',
            ExpressionAttributeValues: {
                ':uid': userId,
            },
            Select: 'COUNT'
        }));
        const totalCount = countResult.Count || 0;
        const totalPages = Math.ceil(totalCount / limit);
        const currentPage = Math.floor(pageOffset / limit) + 1;

        // Step 3: Query paginated posts
        const queryParams = {
            TableName: process.env.DYNAMODB_TABLE_POSTS,
            IndexName: 'userId-createdAt-index',
            KeyConditionExpression: 'userId = :uid',
            ExpressionAttributeValues: {
                ':uid': userId,
            },
            Limit: Number(limit),
            ScanIndexForward: false,
            ExclusiveStartKey: lastEvaluatedKey
                ? JSON.parse(Buffer.from(lastEvaluatedKey, 'base64').toString())
                : undefined
        };

        const result = await docClient.send(new QueryCommand(queryParams));


        // 1. Paginated posts (already fetched via QueryCommand)
        const posts = result.Items || [];

        // 2. Enhance each post with comments and reactions count
        const enhancedPosts = await Promise.all(posts.map(async (post) => {
            const postId = post.postId;

            const commentParams = {
                TableName: process.env.DYNAMODB_TABLE_COMMENTS,
                IndexName: 'PostIdIndex', // must exist
                KeyConditionExpression: 'postId = :pid',
                ExpressionAttributeValues: { ':pid': postId },
                Select: 'COUNT'
            }
            const commentResult = await docClient.send(new QueryCommand(commentParams));

            // 2.1 Count comments using PostIdIndex
            // const commentResult = await dynamoDb.query().promise();
            const commentsCount = commentResult.Count || 0;
            // const reactionsparams = {
            //     // TableName: process.env.DYNAMODB_TABLE_REACTIONS,
            //     // IndexName: 'postId-index', // must exist
            //     // KeyConditionExpression: 'postId = :pid',
            //     // ExpressionAttributeValues: { ':pid': postId },
            //     // Select: 'COUNT'
            //     TableName: process.env.DYNAMODB_TABLE_REACTIONS,
            //     FilterExpression: 'postId = :pid',
            //     ExpressionAttributeValues: {
            //         ':pid': postId
            //     }
            // }

            //             const reactionsParams = {
            //   TableName: process.env.DYNAMODB_TABLE_REACTIONS,
            //   IndexName: 'PostIdIndex',
            //   KeyConditionExpression: 'postId = :pid',
            //   ExpressionAttributeValues: {
            //     ':pid': postId
            //   },
            //   Select: 'COUNT'
            // };
            //             // 2.2 Get all reactions using scan (you can optimize this later)
            //             const reactionResult = await docClient.send(new QueryCommand(reactionsParams));
            //             const reactions = reactionResult.Items || [];
            // console.log('re',reactionResult.Items)
            //             // 2.3 Grouped reactions count
            //             const reactionsCount = reactions.reduce((acc, r) => {
            //                 acc[r.reactionType] = (acc[r.reactionType] || 0) + 1;
            //                 return acc;
            //             }, {});

            //             // 2.4 Total reactions
            //             const totalReactions = Object.values(reactionsCount).reduce((sum, count) => sum + count, 0);

            const reactionsParams = {
                TableName: process.env.DYNAMODB_TABLE_REACTIONS,
                IndexName: 'PostIdIndex',
                KeyConditionExpression: 'postId = :pid',
                ExpressionAttributeValues: {
                    ':pid': postId
                }
            };

            // Fetch all reactions for this postId
            const reactionResult = await docClient.send(new QueryCommand(reactionsParams));

            const reactions = reactionResult.Items || [];

            // ✅ 1. Grouped reaction count
            const reactionsCount = reactions.reduce((acc, r) => {
                acc[r.reactionType] = (acc[r.reactionType] || 0) + 1;
                return acc;
            }, {});

            // ✅ 2. Total reactions
            const totalReactions = reactions.length;

            // 2.5 Return the enriched post
            return {
                ...post,
                commentsCount,
                reactionsCount,
                totalReactions
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

module.exports = app;
