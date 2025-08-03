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
    message: "Hello from path! Mnage audio API is working!",
  });
});

const AUDIO_MIME_TYPES = [
  'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/x-m4a',
  'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wave'
];

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];


app.patch('/update-audio', upload.none(), async (req, res) => {
  const {
    audioId,
    userId,
    updates = {},
    audioMeta,
    coverImageMeta
  } = req.body;

  if (!audioId || !userId) {
    return res.status(400).json({
      success: false,
      error: 'Missing audioId or userId'
    });
  }

  try {
    const { Item: audioItem } = await dynamoDb.get({
      TableName: AUDIO_TABLE,
      Key: { audioId }
    }).promise();

    if (!audioItem) {
      return res.status(404).json({ success: false, error: 'Audio not found' });
    }

    if (audioItem.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied. You do not own this audio.' });
    }

    const allowedFields = ['title', 'artist', 'label', 'duration', 'genre', 'album', 'language', 'bitrate', 'active', 'upload_status'];
    const expressionParts = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    for (const key of allowedFields) {
      if (key in updates) {
        expressionParts.push(`#${key} = :${key}`);
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] =
          ['duration', 'bitrate'].includes(key) ? Number(updates[key]) : updates[key];
      }
    }

    // Handle optional audio/coverImage replacement
    const uploadUrls = {};
    let updatedFileName = null;
    let updatedCoverFileName = null;

    const parsedAudioMeta = audioMeta ? (typeof audioMeta === 'string' ? JSON.parse(audioMeta) : audioMeta) : null;
    const parsedCoverImageMeta = coverImageMeta ? (typeof coverImageMeta === 'string' ? JSON.parse(coverImageMeta) : coverImageMeta) : null;

    if (parsedAudioMeta) {
      if (!parsedAudioMeta.fileName || !AUDIO_MIME_TYPES.includes(parsedAudioMeta.mimeType)) {
        return res.status(400).json({ error: 'Invalid audio metadata' });
      }

      const sanitizedAudioName = parsedAudioMeta.fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
      const audioS3Key = `${env}/public/audio/${audioId}/${sanitizedAudioName}`;

      const audioUploadUrl = s3.getSignedUrl('putObject', {
        Bucket: ENV_AWS_BUCKET_NAME,
        Key: audioS3Key,
        ContentType: parsedAudioMeta.mimeType,
        Expires: 300,
      });

      expressionParts.push('#fileName = :fileName');
      expressionParts.push('#mimeType = :mimeType');
      expressionParts.push('#s3Key = :s3Key');
      expressionParts.push('#mediaUrl = :mediaUrl');

      Object.assign(expressionAttributeNames, {
        '#fileName': 'fileName',
        '#mimeType': 'mimeType',
        '#s3Key': 's3Key',
        '#mediaUrl': 'mediaUrl'
      });

      Object.assign(expressionAttributeValues, {
        ':fileName': sanitizedAudioName,
        ':mimeType': parsedAudioMeta.mimeType,
        ':s3Key': audioS3Key,
        ':mediaUrl': audioS3Key
      });

      uploadUrls.audio = { uploadUrl: audioUploadUrl, fileName: sanitizedAudioName };
      updatedFileName = sanitizedAudioName;
    }

    if (parsedCoverImageMeta) {
      if (!parsedCoverImageMeta.fileName || !IMAGE_MIME_TYPES.includes(parsedCoverImageMeta.mimeType)) {
        return res.status(400).json({ error: 'Invalid cover image metadata' });
      }

      const sanitizedCoverName = parsedCoverImageMeta.fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
      const coverS3Key = `${env}/public/audio/${audioId}/cover/${sanitizedCoverName}`;

      const coverUploadUrl = s3.getSignedUrl('putObject', {
        Bucket: ENV_AWS_BUCKET_NAME,
        Key: coverS3Key,
        ContentType: parsedCoverImageMeta.mimeType,
        Expires: 300,
      });

      expressionParts.push('#coverImageUrl = :coverImageUrl');
      expressionAttributeNames['#coverImageUrl'] = 'coverImageUrl';
      expressionAttributeValues[':coverImageUrl'] = coverS3Key;

      uploadUrls.coverImage = { uploadUrl: coverUploadUrl, fileName: sanitizedCoverName };
      updatedCoverFileName = sanitizedCoverName;
    }

    if (expressionParts.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update.' });
    }

    await dynamoDb.update({
      TableName: AUDIO_TABLE,
      Key: { audioId },
      UpdateExpression: 'SET ' + expressionParts.join(', '),
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues
    }).promise();

    return res.status(200).json({
      success: true,
      message: 'Audio updated successfully',
      audioId,
      updatedFields: Object.keys(expressionAttributeValues).map(k => k.replace(':', '')),
      uploadUrls: Object.keys(uploadUrls).length ? uploadUrls : undefined
    });

  } catch (error) {
    console.error('Error updating audio:', error);
    return res.status(500).json({ error: 'Failed to update audio' });
  }
});

// delete individual audio file
app.delete('/delete', async (req, res) => {
  try {
    const { audioId, userId } = req.body;

    if (!audioId || !userId) {
      return res.status(400).json({ error: 'Missing audioId or userId' });
    }

    // Fetch audio metadata
    const { Item: audioItem } = await dynamoDb.get({
      TableName: AUDIO_TABLE,
      Key: { audioId }
    }).promise();

    if (!audioItem || audioItem.userId !== userId) {
      return res.status(404).json({ error: 'Audio not found or unauthorized' });
    }

    // Prepare S3 keys to delete
    const objectsToDelete = [
      { Key: audioItem.s3Key }
    ];

    if (audioItem.coverImageUrl) {
      objectsToDelete.push({ Key: audioItem.coverImageUrl });
    }

    // Delete from S3
    await s3.deleteObjects({
      Bucket: ENV_AWS_BUCKET_NAME,
      Delete: {
        Objects: objectsToDelete,
        Quiet: true
      }
    }).promise();

    // Delete from DynamoDB: Audio table
    await dynamoDb.delete({
      TableName: AUDIO_TABLE,
      Key: { audioId }
    }).promise();



    return res.status(200).json({
      success: true,
      message: 'Audio deleted successfully'
    });

  } catch (error) {
    console.error('Audio deletion error:', error);
    return res.status(500).json({ error: 'Failed to delete audio or files' });
  }
});









module.exports = app;

