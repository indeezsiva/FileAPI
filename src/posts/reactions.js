// reactions.js
require('dotenv').config();
const express = require('express');
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const app = express();
const multer = require('multer');
const cors = require("cors");
const env = process.env.APP_ENV || 'dev'; // 'dev', 'prod', etc.
const serverless = require('serverless-http');
const fileService = require('../../aws.service');

const APP_ENV = process.env.APP_ENV;
const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME;
const DYNAMODB_TABLE_USERS = process.env.DYNAMODB_TABLE_USERS;
const DYNAMODB_TABLE_POSTS = process.env.DYNAMODB_TABLE_POSTS;
const DYNAMODB_TABLE_REACTIONS = process.env.DYNAMODB_TABLE_REACTIONS;

const POSTS_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_POSTS}`;
const USERS_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_USERS}`;
const REACTIONS_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_REACTIONS}`;
// aws config for aws access
AWS.config.update({
  region: process.env.REGION,
  accessKeyId: process.env.ACCESS_KEY_ID,
  secretAccessKey: process.env.SECRET_ACCESS_KEY,
});
const s3 = new AWS.S3();

AWS.config.update({ region: process.env.REGION });
const dynamoDb = new AWS.DynamoDB.DocumentClient();

const crypto = require('crypto');

// Generate a 32-byte (256-bit) key for AES-256
const key = crypto.randomBytes(32).toString('hex');
console.log('AES Key:', key); // Save this securely
const CryptoJS = require("crypto-js");

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || key; // use .env for prod

function encryptData(data) {
  const ciphertext = CryptoJS.AES.encrypt(JSON.stringify(data), ENCRYPTION_KEY).toString();
  return ciphertext;
}

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());



app.post('/', async (req, res) => {
  const { userId, postId, commentId = null, reactionType } = req.body;

  if (!userId || !reactionType || (!postId && !commentId)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    let filterExpression = 'userId = :uid';
    const expressionValues = { ':uid': userId };

    if (commentId) {
      // Reacting to a comment → completely block duplicates
      filterExpression += ' AND commentId = :cid';
      expressionValues[':cid'] = commentId;
    } else {
      // Reacting to a post → allow different types, but not same type again
      filterExpression += ' AND postId = :pid AND commentId = :null AND reactionType = :rt';
      expressionValues[':pid'] = postId;
      expressionValues[':null'] = null;
      expressionValues[':rt'] = reactionType;
    }

    const existing = await dynamoDb.scan({
      TableName: REACTIONS_TABLE,
      FilterExpression: filterExpression,
      ExpressionAttributeValues: expressionValues
    }).promise();

    if ((existing.Items || []).length > 0) {
      return res.status(409).json({
        success: false,
        message: 'User has already reacted with this type to the post or comment'
      });
    }

    // Step 3: Save new reaction
    const reactionId = 'reaction-' + uuidv4();
    const createdAt = new Date().toISOString();

    const reaction = {
      reactionId,
      userId,
      reactionType,
      createdAt,
      ...(postId && { postId }),
      ...(commentId && { commentId })
    };

    await dynamoDb.put({
      TableName: REACTIONS_TABLE,
      Item: reaction
    }).promise();

    return res.status(201).json({ success: true, message: 'Reaction added', data: reaction });

  } catch (err) {
    console.error('Add reaction error:', err);
    return res.status(500).json({ error: 'Failed to add reaction' });
  }
});

// old api method for adding reactions
// app.post('/', async (req, res) => {
//   const { userId, postId, commentId = null, reactionType } = req.body;

//   if (!userId || !reactionType || (!postId && !commentId)) {
//     return res.status(400).json({ error: 'Missing required fields' });
//   }

//   try {
//     const reactionId = 'reaction-' + uuidv4();
//     const createdAt = new Date().toISOString();

//     const reaction = {
//       reactionId,
//       userId,
//       postId: postId || undefined,
//       commentId: commentId || undefined,
//       reactionType,
//       createdAt
//     };

//     await dynamoDb.put({
//       TableName: REACTIONS_TABLE,
//       Item: reaction
//     }).promise();

//     return res.status(201).json({ success: true, message: 'Reaction added', data: reaction });

//   } catch (err) {
//     console.error('Add reaction error:', err);
//     return res.status(500).json({ error: 'Failed to add reaction' });
//   }
// });


app.delete('/:reactionId', async (req, res) => {
  const { reactionId } = req.params;

  try {
    await dynamoDb.delete({
      TableName: REACTIONS_TABLE,
      Key: { reactionId }
    }).promise();

    return res.status(200).json({ success: true, message: 'Reaction deleted' });

  } catch (err) {
    console.error('Delete reaction error:', err);
    return res.status(500).json({ error: 'Failed to delete reaction' });
  }
});

app.get('/', async (req, res) => {
  const { postId, commentId } = req.query;

  if (!postId && !commentId) {
    return res.status(400).json({ error: 'postId or commentId is required' });
  }

  const filterKey = postId ? 'postId' : 'commentId';
  const filterValue = postId || commentId;

  try {
    // Step 1: Scan reactions
    const result = await dynamoDb.scan({
      TableName: REACTIONS_TABLE,
      FilterExpression: `${filterKey} = :val`,
      ExpressionAttributeValues: {
        ':val': filterValue
      }
    }).promise();

    const reactions = result.Items || [];

    // Step 2: Collect unique userIds
    const userIds = [...new Set(reactions.map(r => r.userId))];

    // Step 3: Fetch user details
    let userMap = {};
    if (userIds.length > 0) {
      const userResults = await dynamoDb.batchGet({
        RequestItems: {
          [USERS_TABLE]: {
            Keys: userIds.map(id => ({ userId: id })),
            ProjectionExpression: 'userId, firstName, lastName, email, avatarUrl'
          }
        }
      }).promise();

      const userProfiles = userResults.Responses[USERS_TABLE] || [];
      for (const profile of userProfiles) {
        if (profile.avatarUrl && !profile.avatarUrl.startsWith('http')) {
          profile.avatarUrl = fileService.getSignedMediaUrl(profile.avatarUrl);
        }
      }
      userMap = Object.fromEntries(userProfiles.map(u => [u.userId, u]));
    }

    // Step 4: Attach user info to each reaction
    const enriched = reactions.map(r => ({
      ...r,
      user: userMap[r.userId] || null
    }));

    return res.status(200).json({ success: true, data: enriched });

  } catch (err) {
    console.error('Fetch reactions error:', err);
    return res.status(500).json({ error: 'Failed to fetch reactions' });
  }
});



module.exports = app;

