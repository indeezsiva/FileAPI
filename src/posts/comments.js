// comments.js
require('dotenv').config();
const express = require('express');
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const app = express();
const cors = require("cors");
const env = process.env.APP_ENV || 'dev'; // 'dev', 'prod', etc.
const fileService = require('../../aws.service');

const APP_ENV = process.env.APP_ENV;
const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME;
const DYNAMODB_TABLE_USERS = process.env.DYNAMODB_TABLE_USERS;
const DYNAMODB_TABLE_POSTS = process.env.DYNAMODB_TABLE_POSTS;
const DYNAMODB_TABLE_COMMENTS = process.env.DYNAMODB_TABLE_COMMENTS;


const POSTS_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_POSTS}`;
const USERS_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_USERS}`;
const COMMENTS_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_COMMENTS}`;
const ENV_AWS_BUCKET_NAME = `${APP_ENV}-${AWS_BUCKET_NAME}`;

// aws config for aws access
AWS.config.update({
  region: process.env.REGION,
  accessKeyId: process.env.ACCESS_KEY_ID,
  secretAccessKey: process.env.SECRET_ACCESS_KEY,
});
const s3 = new AWS.S3();

AWS.config.update({ region: process.env.REGION });
const dynamoDb = new AWS.DynamoDB.DocumentClient();

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());



app.post('/posts/:postId', async (req, res) => {
  const { postId } = req.params;
  const { userId, commentText, parentCommentId } = req.body;

  if (!userId || !commentText) {
    return res.status(400).json({
      error: 'Missing required fields',
      required: ['userId', 'commentText']
    });
  }

  try {
    // Validate commentText for profanity
    const { Filter } = await import('bad-words');
    const filter = new Filter();
    if (filter.isProfane(commentText)) {
      return res.status(400).json({ success: false, error: 'Comment contains inappropriate language.' });
    }

    // Validate userId
    const userResult = await dynamoDb.get({
      TableName: USERS_TABLE,
      Key: { userId }
    }).promise();

    if (!userResult.Item) {
      return res.status(404).json({ error: 'Invalid userId. User not found.' });
    }

    // Validate postId
    const postResult = await dynamoDb.get({
      TableName: POSTS_TABLE,
      Key: { postId }
    }).promise();

    if (!postResult.Item) {
      return res.status(404).json({ error: 'Invalid postId. Post not found.' });
    }

    // Construct comment
    const commentId = 'comment-' + uuidv4();
    const createdAt = new Date().toISOString();

    const comment = {
      commentId,
      postId,
      userId,
      commentText,
      createdAt,
      status: 'active',
      repliesCount: 0
    };
    // ⚠️ Only include parentCommentId if it's present and not null
    if (typeof parentCommentId === 'string' && parentCommentId.trim() !== '') {
      // Validate that parentCommentId exists in DB
      const parentResult = await dynamoDb.get({
        TableName: COMMENTS_TABLE,
        Key: { commentId: parentCommentId }
      }).promise();

      if (!parentResult.Item) {
        return res.status(404).json({ error: 'Invalid parentCommentId. Parent comment not found.' });
      }

      comment.parentCommentId = parentCommentId;
    }
    // Save comment
    await dynamoDb.put({
      TableName: COMMENTS_TABLE,
      Item: comment
    }).promise();

    // Optionally update parent comment's reply count
    if (comment.parentCommentId) {
      await dynamoDb.update({
        TableName: COMMENTS_TABLE,
        Key: { commentId: parentCommentId },
        UpdateExpression: 'ADD repliesCount :inc',
        ExpressionAttributeValues: { ':inc': 1 }
      }).promise();
    }

    return res.status(201).json({
      success: true,
      message: parentCommentId ? 'Reply added' : 'Comment added',
      data: comment
    });

  } catch (err) {
    console.error('Create comment error:', err);
    return res.status(500).json({ error: 'Failed to create comment' });
  }
});


app.get('/posts/:postId', async (req, res) => {
  const { postId } = req.params;

  try {
    // Step 1: Fetch comments for the post
    const result = await dynamoDb.query({
      TableName: COMMENTS_TABLE,
      IndexName: 'PostIdIndex',
      KeyConditionExpression: 'postId = :pid',
      ExpressionAttributeValues: {
        ':pid': postId
      }
    }).promise();

    const comments = result.Items || [];

    // Step 2: Collect unique userIds and commentIds
    const userIds = [...new Set(comments.map(c => c.userId))];
    const commentIds = comments.map(c => c.commentId);

    // Step 3: Fetch user details
    let userDetailsMap = {};
    if (userIds.length > 0) {
      const userDetailsResult = await dynamoDb.batchGet({
        RequestItems: {
          [USERS_TABLE]: {
            Keys: userIds.map(userId => ({ userId })),
            ProjectionExpression: 'userId, firstName, lastName, email, avatarUrl'
          }
        }
      }).promise();

      const userProfiles = userDetailsResult.Responses[USERS_TABLE] || [];

      for (const profile of userProfiles) {
        if (profile.avatarUrl && !profile.avatarUrl.startsWith('http')) {
          profile.avatarUrl = fileService.getSignedMediaUrl(profile.avatarUrl);
        }
      }

      userDetailsMap = Object.fromEntries(userProfiles.map(u => [u.userId, u]));

    }

    // Step 4: Fetch like counts per commentId
    const likeCountsMap = {};

    for (const commentId of commentIds) {
      const likeResult = await dynamoDb.query({
        TableName: process.env.DYNAMODB_TABLE_REACTIONS,
        IndexName: 'commentId-reactionType-index',
        KeyConditionExpression: 'commentId = :cid AND reactionType = :like',
        ExpressionAttributeValues: {
          ':cid': commentId,
          ':like': 'like'
        },
        Select: 'COUNT'
      }).promise();

      likeCountsMap[commentId] = likeResult.Count || 0;
    }

    // Step 5: Organize replies
    const replyMap = {};
    const topLevel = [];

    for (const comment of comments) {
      const userInfo = userDetailsMap[comment.userId] || {};
      const likeCount = likeCountsMap[comment.commentId] || 0;

      const enrichedComment = {
        ...comment,
        user: userInfo,
        likeCount
      };

      if (comment.parentCommentId) {
        if (!replyMap[comment.parentCommentId]) {
          replyMap[comment.parentCommentId] = [];
        }
        replyMap[comment.parentCommentId].push(enrichedComment);
      } else {
        topLevel.push(enrichedComment);
      }
    }

    // Step 6: Build final response with replies
    const response = topLevel.map(c => ({
      ...c,
      replies: replyMap[c.commentId] || []
    }));

    return res.status(200).json({ success: true, data: response });

  } catch (err) {
    console.error('Fetch comments error:', err);
    return res.status(500).json({ error: 'Failed to get comments and replies' });
  }
});


// old 
// app.get('/posts/:postId', async (req, res) => {
//   const { postId } = req.params;

//   try {
//     // Step 1: Fetch comments for the post
//     const result = await dynamoDb.query({
//       TableName: COMMENTS_TABLE,
//       IndexName: 'PostIdIndex',
//       KeyConditionExpression: 'postId = :pid',
//       ExpressionAttributeValues: {
//         ':pid': postId
//       }
//     }).promise();

//     const comments = result.Items || [];

//     // Step 2: Collect unique userIds
//     const userIds = [...new Set(comments.map(c => c.userId))];

//     // Step 3: Fetch user details from USER_TABLE
//     let userDetailsMap = {};
//     if (userIds.length > 0) {
//       const userDetailsResult = await dynamoDb.batchGet({
//         RequestItems: {
//           [USERS_TABLE]: {
//             Keys: userIds.map(userId => ({ userId })),
//             ProjectionExpression: 'userId, firstName, lastName, email, avatarUrl'
//           }
//         }
//       }).promise();

//       const userProfiles = userDetailsResult.Responses[USERS_TABLE] || [];
//       userDetailsMap = Object.fromEntries(userProfiles.map(u => [u.userId, u]));
//     }

//     // Step 4: Organize replies
//     const replyMap = {};
//     const topLevel = [];

//     for (const comment of comments) {
//       const userInfo = userDetailsMap[comment.userId] || {};
//       const enrichedComment = { ...comment, user: userInfo };

//       if (comment.parentCommentId) {
//         if (!replyMap[comment.parentCommentId]) {
//           replyMap[comment.parentCommentId] = [];
//         }
//         replyMap[comment.parentCommentId].push(enrichedComment);
//       } else {
//         topLevel.push(enrichedComment);
//       }
//     }

//     // Step 5: Build final response with replies
//     const response = topLevel.map(c => ({
//       ...c,
//       replies: replyMap[c.commentId] || []
//     }));

//     return res.status(200).json({ success: true, data: response });

//   } catch (err) {
//     console.error('Fetch comments error:', err);
//     return res.status(500).json({ error: 'Failed to get comments and replies' });
//   }
// });



app.get('/posts/:postId/:commentId', async (req, res) => {
  const { postId, commentId } = req.params;

  try {
    // Step 1: Get comment by commentId
    const result = await dynamoDb.get({
      TableName: COMMENTS_TABLE,
      Key: { commentId }
    }).promise();

    const comment = result.Item;

    // Step 2: Validate comment and postId match
    if (!comment || comment.postId !== postId) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Step 3: Fetch user details
    let user = null;
    if (comment.userId) {
      const userResult = await dynamoDb.get({
        TableName: USERS_TABLE,
        Key: { userId: comment.userId },
        ProjectionExpression: 'userId, firstName, lastName, email, avatarUrl'
      }).promise();

      user = userResult.Item || null;
      if (user) {
        if (user.avatarUrl && !user.avatarUrl.startsWith('http')) {
          user.avatarUrl = fileService.getSignedMediaUrl(user.avatarUrl);
        }
      }

    }

    // Step 4: Attach user to comment
    const enrichedComment = { ...comment, user };

    return res.status(200).json({ success: true, data: enrichedComment });

  } catch (err) {
    console.error('Fetch comment error:', err);
    return res.status(500).json({ error: 'Failed to get comment' });
  }
});

app.patch('/posts/:postId/:commentId', async (req, res) => {
  const { postId, commentId } = req.params;
  const { userId, commentText } = req.body;

  if (!userId || !commentText) {
    return res.status(400).json({ error: 'Missing userId or commentText' });
  }

  try {

    // Validate commentText for profanity
    const { Filter } = await import('bad-words');
    const filter = new Filter();
    if (filter.isProfane(commentText)) {
      return res.status(400).json({ success: false, error: 'Comment contains inappropriate language.' });
    }

    const { Item: comment } = await dynamoDb.get({
      TableName: COMMENTS_TABLE,
      Key: { commentId }
    }).promise();


    if (!comment || comment.postId !== postId) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    if (comment.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized: not your comment' });
    }

    await dynamoDb.update({
      TableName: COMMENTS_TABLE,
      Key: { commentId },
      UpdateExpression: 'SET commentText = :text, #s = :status',
      ExpressionAttributeNames: {
        '#s': 'status'
      },
      ExpressionAttributeValues: {
        ':text': commentText,
        ':status': 'edited'
      }
    }).promise();

    return res.status(200).json({ success: true, message: 'Comment updated' });

  } catch (err) {
    console.error('Update comment error:', err);
    return res.status(500).json({ error: 'Failed to update comment' });
  }
});


app.delete('/posts/:postId/:commentId', async (req, res) => {
  const { postId, commentId } = req.params;
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  try {
    // 1. Get original comment
    const { Item: comment } = await dynamoDb.get({
      TableName: COMMENTS_TABLE,
      Key: { commentId }
    }).promise();

    if (!comment || comment.postId !== postId) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    if (comment.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized: Not your comment' });
    }

    // 2. Query for replies (child comments)
    const replyResult = await dynamoDb.query({
      TableName: COMMENTS_TABLE,
      IndexName: 'ParentCommentIndex', // You must define this GSI
      KeyConditionExpression: 'parentCommentId = :pcid',
      ExpressionAttributeValues: {
        ':pcid': commentId
      }
    }).promise();

    const replies = replyResult.Items || [];

    // 3. Delete all replies (in batches of 25 max)
    const deleteRequests = replies.map(reply => ({
      DeleteRequest: {
        Key: { commentId: reply.commentId }
      }
    }));

    if (deleteRequests.length > 0) {
      const BATCH_SIZE = 25;
      for (let i = 0; i < deleteRequests.length; i += BATCH_SIZE) {
        const batch = deleteRequests.slice(i, i + BATCH_SIZE);
        await dynamoDb.batchWrite({
          RequestItems: {
            [COMMENTS_TABLE]: batch
          }
        }).promise();
      }
    }

    // 4. Delete the original comment
    await dynamoDb.delete({
      TableName: COMMENTS_TABLE,
      Key: { commentId }
    }).promise();

    return res.status(200).json({
      success: true,
      message: `Comment and ${replies.length} replies deleted`
    });

  } catch (err) {
    console.error('Cascade delete comment error:', err);
    return res.status(500).json({ error: 'Failed to delete comment and replies' });
  }
});



module.exports = app;

