// posts.js
require('dotenv').config();
const express = require('express');
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const PORT = 4000;
require('dotenv').config();
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
const app = express();
const multer = require('multer');
const cors = require("cors");
const env = process.env.APP_ENV || 'dev'; // 'dev', 'prod', etc.
const serverless = require('serverless-http');
const fileService = require('./aws.service'); // Assuming your multipart upload function is in fileService.js
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

function encryptData(data) {
  const ciphertext = CryptoJS.AES.encrypt(JSON.stringify(data), ENCRYPTION_KEY).toString();
  return ciphertext;
}

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// healthcheck
/**
 * @swagger
 * /health-check:
 *   get:
 *     summary: Health check endpoint
 *     responses:
 *       200:
 *         description: Health check successful
 */
app.get("/health-check", (req, res, next) => {
  return res.status(200).json({
    message: "Hello from path! Health check POST API is working!",
  });
});

/**
 * @swagger
 * /upload-url:
 *   post:
 *     summary: Generate a pre-signed URL for uploading a file
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fileName:
 *                 type: string
 *               mimeType:
 *                 type: string
 *               userId:
 *                 type: string
 *               resourceType:
 *                 type: string
 *     responses:
 *       200:
 *         description: Upload URL generated
 */
// Generate pre-signed upload URL and store metadata in DynamoDB

app.post('/create-post', upload.single('file'), async (req, res) => {
  try {
    const {
      userId,
      content, // For text-based posts
      fileName,
      mimeType,
      resourceType = 'default', // e.g., "image", "video", "text", etc.
      privacy = 'public',
    } = req.body;

    // Validate required fields
    if (!userId || (!req.file && !content)) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: {
          required: ['userId', 'file OR content'],
          received: {
            userId: !!userId,
            file: !!req.file,
            content: !!content,
          },
        },
      });
    }

    const postId = uuidv4();
    const createdAt = new Date().toISOString();

    let post = {
      postId,
      userId,
      createdAt,
      resourceType,
      status: 'active',
      privacy,
      views: 0,
      likesCount: 0,
      commentsCount: 0,
    };

    // If media file is present
    if (req.file) {
      const file = req.file;
      const fileExt = fileName.split('.').pop().toLowerCase();
      const sanitizedFileName = fileName
        .replace(/\s+/g, '-')
        .replace(/[^a-zA-Z0-9-.]/g, '');

      const s3Key = `${process.env.APP_ENV}/${userId}/${resourceType}/${sanitizedFileName}`;

      const uploadResult = await fileService.s3UploadMultiPart({
        Key: s3Key,
        Body: file.buffer,
        ContentType: mimeType,
      });

      post = {
        ...post,
        postType: resourceType,
        fileName: sanitizedFileName,
        mimeType,
        s3Key,
        mediaUrl: uploadResult.Location,
      };
    }

    // If content is text-only
    if (!req.file && content) {
      post = {
        ...post,
        postType: resourceType,
        content,
      };
    }

    // Save post in DynamoDB
    await dynamoDb
      .put({
        TableName: process.env.DYNAMODB_TABLE_POSTS,
        Item: post,
        ConditionExpression: 'attribute_not_exists(postId)',
      })
      .promise();

    return res.status(201).json({
      success: true,
      message: 'Post created successfully',
      data: post,
    });
  } catch (error) {
    console.error('Post creation failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Post creation failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});


app.patch('/update-post/:postId', upload.single('file'), async (req, res) => {
  try {
    const { postId } = req.params;
    const {
      userId,
      content,
      fileName,
      mimeType,
      resourceType,
      privacy,
    } = req.body;

    // Validate postId and userId
    if (!postId || !userId) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: {
          required: ['postId', 'userId'],
          received: { postId: !!postId, userId: !!userId },
        },
      });
    }

    // Fetch existing post
    const existingPostResult = await dynamoDb.get({
      TableName: process.env.DYNAMODB_TABLE_POSTS,
      Key: { postId },
    }).promise();

    if (!existingPostResult.Item) {
      return res.status(404).json({
        success: false,
        error: 'Post not found',
      });
    }

    let updatedPost = { ...existingPostResult.Item };

    // Update media if new file is uploaded
    if (req.file && fileName && mimeType) {
      const file = req.file;
      const sanitizedFileName = fileName
        .replace(/\s+/g, '-')
        .replace(/[^a-zA-Z0-9-.]/g, '');
      const s3Key = `${process.env.APP_ENV}/${userId}/${resourceType}/${sanitizedFileName}`;

      const uploadResult = await fileService.s3UploadMultiPart({
        Key: s3Key,
        Body: file.buffer,
        ContentType: mimeType,
      });

      updatedPost = {
        ...updatedPost,
        postType: resourceType,
        fileName: sanitizedFileName,
        mimeType,
        s3Key,
        mediaUrl: uploadResult.Location,
        updatedAt: new Date().toISOString(),
      };
    }

    // Update text content if provided
    if (content) {
      updatedPost = {
        ...updatedPost,
        postType: resourceType || 'text',
        content,
        updatedAt: new Date().toISOString(),
      };
    }

    // Update privacy if changed
    if (privacy) {
      updatedPost.privacy = privacy;
      updatedPost.updatedAt = new Date().toISOString();
    }

    // Save updated post
    await dynamoDb.put({
      TableName: process.env.DYNAMODB_TABLE_POSTS,
      Item: updatedPost,
    }).promise();

    return res.status(200).json({
      success: true,
      message: 'Post updated successfully',
      data: updatedPost,
    });
  } catch (error) {
    console.error('Post update failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Post update failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

app.delete('/delete-post/:postId', async (req, res) => {
  const { postId } = req.params;

  if (!postId) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameter: postId',
    });
  }

  try {
    await dynamoDb
      .delete({
        TableName: process.env.DYNAMODB_TABLE_POSTS,
        Key: { postId },
        ConditionExpression: 'attribute_exists(postId)',
      })
      .promise();

    return res.status(200).json({
      success: true,
      message: 'Post deleted successfully',
      postId,
    });
  } catch (error) {
    console.error('Post deletion failed:', error);

    const isConditionalCheck = error.code === 'ConditionalCheckFailedException';

    return res.status(isConditionalCheck ? 404 : 500).json({
      success: false,
      error: isConditionalCheck ? 'Post not found' : 'Failed to delete post',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});


app.get('/:postId', async (req, res) => {
  const { postId } = req.params;

  if (!postId) {
    return res.status(400).json({ success: false, error: 'Missing postId' });
  }

  try {
    const result = await dynamoDb
      .get({
        TableName: process.env.DYNAMODB_TABLE_POSTS,
        Key: { postId },
      })
      .promise();

    if (!result.Item) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    return res.status(200).json({ success: true, data: result.Item });
  } catch (error) {
    console.error('Failed to get post:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve post' });
  }
});


app.get('/user/:userId', async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ success: false, error: 'Missing userId' });
  }

  try {
    const result = await dynamoDb
      .query({
        TableName: process.env.DYNAMODB_TABLE_POSTS,
        IndexName: 'userId-index', // Ensure this GSI exists
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: {
          ':uid': userId,
        },
      })
      .promise();

    return res.status(200).json({ success: true, data: result.Items });
  } catch (error) {
    console.error('Failed to get posts:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve posts' });
  }
});


app.get('/', async (req, res) => {
  const { userId, limit = 20, lastEvaluatedKey } = req.query;

  let params;

  if (userId) {
    // Use query with GSI if userId is specified
    params = {
      TableName: process.env.DYNAMODB_TABLE_POSTS,
      IndexName: 'userId-index', // GSI must exist!
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: {
        ':uid': userId,
      },
      Limit: Number(limit),
      ScanIndexForward: false, // newest posts first
    };
  } else {
    // Otherwise, scan all posts
    params = {
      TableName: process.env.DYNAMODB_TABLE_POSTS,
      Limit: Number(limit),
    };
  }

  if (lastEvaluatedKey) {
    try {
      params.ExclusiveStartKey = JSON.parse(lastEvaluatedKey);
    } catch (err) {
      return res.status(400).json({ success: false, error: 'Invalid lastEvaluatedKey' });
    }
  }

  try {
    const method = userId ? 'query' : 'scan';
    const result = await dynamoDb[method](params).promise();

    return res.status(200).json({
      success: true,
      data: result.Items,
      lastEvaluatedKey: result.LastEvaluatedKey || null,
    });
  } catch (error) {
    console.error('Failed to get posts:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve posts',
    });
  }
});



module.exports = app;

