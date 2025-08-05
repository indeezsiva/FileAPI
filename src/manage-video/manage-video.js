// posts.js
require('dotenv').config();
const express = require('express');
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const PORT = 4000;
require('dotenv').config();
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('../../swagger');
const app = express();
const multer = require('multer');
const cors = require("cors");
const env = process.env.APP_ENV || 'dev'; // 'dev', 'prod', etc.
const serverless = require('serverless-http');
const fileService = require('../../aws.service'); // Assuming your multipart upload function is in fileService.js
const upload = multer({ storage: multer.memoryStorage() });

const APP_ENV = process.env.APP_ENV;
const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME;
const DYNAMODB_TABLE_VIDEO = process.env.DYNAMODB_TABLE_VIDEO;

const ENV_AWS_BUCKET_NAME = `${APP_ENV}-${AWS_BUCKET_NAME}`;
const VIDEO_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_VIDEO}`;



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
    message: "Hello from path! Mnage video API is working!",
  });
});
const VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/webm',
];
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];

// Update video post API, allows updating video metadata and generating new pre-signed URLs
app.patch('/update-video', upload.none(), async (req, res) => {
  const {
    videoId,
    userId,
    updates = {},
    videoMeta,
    coverImageMeta
  } = req.body;

  if (!videoId || !userId) {
    return res.status(400).json({
      success: false,
      error: 'Missing videoId or userId'
    });
  }

  try {
    const { Item: videoItem } = await dynamoDb.get({
      TableName: VIDEO_TABLE,
      Key: { videoId }
    }).promise();

    if (!videoItem) {
      return res.status(404).json({ success: false, error: 'Video not found' });
    }

    if (videoItem.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied. You do not own this video.' });
    }

    const allowedFields = ['duration', 'resolution', 'format', 'active', 'upload_status'];
    const expressionParts = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    for (const key of allowedFields) {
      if (key in updates) {
        expressionParts.push(`#${key} = :${key}`);
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] =
          ['duration', 'resolution'].includes(key) ? Number(updates[key]) : updates[key];
      }
    }

    // Handle optional video/coverImage replacement
    const uploadUrls = {};
    let updatedFileName = null;
    let updatedCoverFileName = null;

    const parsedVideoMeta = videoMeta ? (typeof videoMeta === 'string' ? JSON.parse(videoMeta) : videoMeta) : null;
    const parsedCoverImageMeta = coverImageMeta ? (typeof coverImageMeta === 'string' ? JSON.parse(coverImageMeta) : coverImageMeta) : null;

    if (parsedVideoMeta) {
      if (!parsedVideoMeta.fileName || !VIDEO_MIME_TYPES.includes(parsedVideoMeta.mimeType)) {
        return res.status(400).json({ error: 'Invalid video metadata' });
      }

      const sanitizedVideoName = parsedVideoMeta.fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
      const videoS3Key = `${env}/public/video/${videoId}/${sanitizedVideoName}`;

      const videoUploadUrl = s3.getSignedUrl('putObject', {
        Bucket: ENV_AWS_BUCKET_NAME,
        Key: videoS3Key,
        ContentType: parsedVideoMeta.mimeType,
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
        ':fileName': sanitizedVideoName,
        ':mimeType': parsedVideoMeta.mimeType,
        ':s3Key': videoS3Key,
        ':mediaUrl': videoS3Key
      });

      uploadUrls.video = { uploadUrl: videoUploadUrl, fileName: sanitizedVideoName };
      updatedFileName = sanitizedVideoName;
    }

    if (parsedCoverImageMeta) {
      if (!parsedCoverImageMeta.fileName || !IMAGE_MIME_TYPES.includes(parsedCoverImageMeta.mimeType)) {
        return res.status(400).json({ error: 'Invalid cover image metadata' });
      }

      const sanitizedCoverName = parsedCoverImageMeta.fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
      const coverS3Key = `${env}/public/video/${videoId}/cover/${sanitizedCoverName}`;

      const coverUploadUrl = s3.getSignedUrl('putObject', {
        Bucket: ENV_AWS_BUCKET_NAME,
        Key: coverS3Key,
        ContentType: parsedCoverImageMeta.mimeType,
        Expires: 300,
      });

      expressionParts.push('#coverImageUrl = :coverImageUrl');
      expressionAttributeNames['#coverImageUrl'] = 'coverImageUrl';
      expressionAttributeValues[':coverImageUrl'] = coverS3Key;

      uploadUrls.coverImage = { uploadUrl: coverUploadUrl, fileName: sanitizedCoverName, key:coverS3Key };
      updatedCoverFileName = sanitizedCoverName;
    }

    if (expressionParts.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update.' });
    }

    await dynamoDb.update({
      TableName: VIDEO_TABLE,
      Key: { videoId },
      UpdateExpression: 'SET ' + expressionParts.join(', '),
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues
    }).promise();

    return res.status(200).json({
      success: true,
      message: 'Video updated successfully',
      videoId,
      updatedFields: Object.keys(expressionAttributeValues).map(k => k.replace(':', '')),
      uploadUrls: Object.keys(uploadUrls).length ? uploadUrls : undefined
    });

  } catch (error) {
    console.error('Error updating video:', error);
    return res.status(500).json({ error: 'Failed to update video' });
  }
});

// delete individual video file
app.delete('/delete', async (req, res) => {
  try {
    const { videoId, userId } = req.body;

    if (!videoId || !userId) {
      return res.status(400).json({ error: 'Missing videoId or userId' });
    }

    // Fetch audio metadata
    const { Item: videoItem } = await dynamoDb.get({
      TableName: VIDEO_TABLE,
      Key: { videoId }
    }).promise();

    if (!videoItem || videoItem.userId !== userId) {
      return res.status(404).json({ error: 'Video not found or unauthorized' });
    }

    // Prepare S3 keys to delete
    const objectsToDelete = [
      { Key: videoItem.s3Key }
    ];

    if (videoItem.coverImageUrl) {
      objectsToDelete.push({ Key: videoItem.coverImageUrl });
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
      TableName: VIDEO_TABLE,
      Key: { videoId }
    }).promise();



    return res.status(200).json({
      success: true,
      message: 'Video deleted successfully'
    });

  } catch (error) {
    console.error('Video deletion error:', error);
    return res.status(500).json({ error: 'Failed to delete Video or files' });
  }
});







module.exports = app;

