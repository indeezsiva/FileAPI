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
    const reactionId = 'reaction-' + uuidv4();
    const createdAt = new Date().toISOString();

    const reaction = {
      reactionId,
      userId,
      postId: postId || undefined,
      commentId: commentId || undefined,
      reactionType,
      createdAt
    };

    await dynamoDb.put({
      TableName: process.env.DYNAMODB_TABLE_REACTIONS,
      Item: reaction
    }).promise();

    return res.status(201).json({ success: true, message: 'Reaction added', data: reaction });

  } catch (err) {
    console.error('Add reaction error:', err);
    return res.status(500).json({ error: 'Failed to add reaction' });
  }
});


app.delete('/:reactionId', async (req, res) => {
  const { reactionId } = req.params;

  try {
    await dynamoDb.delete({
      TableName: process.env.DYNAMODB_TABLE_REACTIONS,
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
      TableName: process.env.DYNAMODB_TABLE_REACTIONS,
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
          [process.env.DYNAMODB_TABLE_USERS]: {
            Keys: userIds.map(id => ({ userId: id })),
            ProjectionExpression: 'userId, firstName, lastName, email, avatarUrl'
          }
        }
      }).promise();

      const users = userResults.Responses[process.env.DYNAMODB_TABLE_USERS] || [];
      userMap = Object.fromEntries(users.map(u => [u.userId, u]));
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

