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

const APP_ENV = process.env.APP_ENV;
const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME;
const DYNAMODB_TABLE_USERS = process.env.DYNAMODB_TABLE_USERS;
const DYNAMODB_TABLE_POSTS = process.env.DYNAMODB_TABLE_POSTS;
const DYNAMODB_TABLE_COMMENTS = process.env.DYNAMODB_TABLE_COMMENTS;
const DYNAMODB_TABLE_REACTIONS = process.env.DYNAMODB_TABLE_REACTIONS;
const DYNAMODB_TABLE_USERS_FOLLOWS = process.env.DYNAMODB_TABLE_USERS_FOLLOWS;
const DYNAMODB_TABLE_IMAGE = process.env.DYNAMODB_TABLE_IMAGE;
const DYNAMODB_TABLE_VIDEO = process.env.DYNAMODB_TABLE_VIDEO;
const DYNAMODB_TABLE_AUDIO = process.env.DYNAMODB_TABLE_AUDIO;
const DYNAMODB_TABLE_PLAYLISTS = process.env.DYNAMODB_TABLE_PLAYLISTS;
const DYNAMODB_TABLE_PLAYLIST_SAVES = process.env.DYNAMODB_TABLE_PLAYLIST_SAVES;

const POSTS_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_POSTS}`;
const USERS_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_USERS}`;
const COMMENTS_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_COMMENTS}`;
const REACTIONS_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_REACTIONS}`;
const ENV_AWS_BUCKET_NAME = `${APP_ENV}-${AWS_BUCKET_NAME}`;
const USER_FOLLOW_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_USERS_FOLLOWS}`;
const IMAGE_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_IMAGE}`;
const VIDEO_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_VIDEO}`;
const AUDIO_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_AUDIO}`;



// aws config for aws access
AWS.config.update({
  region: process.env.REGION,
  accessKeyId: process.env.ACCESS_KEY_ID,
  secretAccessKey: process.env.SECRET_ACCESS_KEY,
});
const s3 = new AWS.S3();

AWS.config.update({ region: process.env.REGION });
const BUCKET = ENV_AWS_BUCKET_NAME;
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
    message: "Hello from path! moderate-image-check API is working!",
  });
});



app.post('/image', async (req, res) => {
  const { key } = req.body;

  if (!key) {
    return res.status(400).json({ success: false, message: 'key is required' });
  }

  const rekognition = new AWS.Rekognition();
  const s3 = new AWS.S3();

  try {
    const { ModerationLabels = [] } = await rekognition.detectModerationLabels({
      Image: {
        S3Object: {
          Bucket: ENV_AWS_BUCKET_NAME,
          Name: key,
        }
      },
      MinConfidence: 80,
    }).promise();
    const isFlagged = ModerationLabels.length > 0;

    if (isFlagged) {
      await s3.deleteObject({
        Bucket: ENV_AWS_BUCKET_NAME,
        Key: key,
      }).promise();

      return res.status(403).json({
        success: false,
        message: 'Inappropriate content detected and deleted',
        labels: ModerationLabels.map(label => label.Name),
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Image passed moderation checks',
      labels: [],
    });

  } catch (err) {
    console.error('Image moderation failed:', err);
    return res.status(500).json({
      success: false,
      message: 'Image moderation failed',
      error: err.message,
    });
  }
});


module.exports = app;

