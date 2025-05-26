// media.js
require('dotenv').config();
const express = require('express');
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const PORT = 4000;
require('dotenv').config();
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
const app = express();
const cors = require("cors");
const env = process.env.APP_ENV || 'dev'; // 'dev', 'prod', etc.

// aws config for aws access
AWS.config.update({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});
const s3 = new AWS.S3();

AWS.config.update({ region: process.env.AWS_REGION });
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
    message: "Hello from path! media check",
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

app.post('/upload-url', async (req, res) => {
  const { fileName, mimeType, userId, resourceType } = req.body;

  if (!fileName || !mimeType || !userId) {
    return res.status(400).json({ error: 'fileName, mimeType, and userId are required' });
  }
  const fileId = uuidv4();
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
  const s3Key = `${env}/${resourceType}/${userId}/${fileName}`;

  try {
    // Generate pre-signed URL
    const uploadUrl = s3.getSignedUrl('putObject', {
      Bucket: BUCKET,
      Key: s3Key,
      ContentType: mimeType,
      Expires: 60 * 5, // 5 minutes
    });

    // Store metadata in DynamoDB, if any other data is required, add it here
    const metadata = {
      userId,
      fileId,
      fileName,
      mimeType,
      s3Key,
      uploadedAt: new Date().toISOString(),
    };

    await dynamoDb.put({
      TableName: process.env.DYNAMODB_TABLE,
      Item: metadata,
    }).promise();

    return res.json({ uploadUrl, s3Key, fileId });
  } catch (err) {
    console.error('Error generating upload URL:', err);
    res.status(500).send('Could not generate upload URL');
  }
});

/**
 * @swagger
 * /download-url:
 *   post:
 *     summary: Generate a pre-signed URL for downloading a file
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               s3Key:
 *                 type: string
 *               userId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Download URL generated
 */
// Generate pre-signed upload URL and store metadata in DynamoDB
app.post('/download-url', async (req, res) => {
  const { s3Key, userId } = req.body;

  if (!s3Key || !userId) {
    return res.status(400).json({ error: 's3Key and userId are required' });
  }

  const expectedPrefix = `dev/files/${userId}/`;
  if (!s3Key.startsWith(expectedPrefix)) {
    return res.status(403).json({ error: 'Access denied: Invalid file path' });
  }

  try {
    const downloadUrl = s3.getSignedUrl('getObject', {
      Bucket: BUCKET,
      Key: s3Key,
      Expires: 60 * 5,
    });

    res.json({ downloadUrl });
  } catch (err) {
    console.error('Error generating download URL:', err);
    res.status(500).send('Could not generate download URL');
  }
});

/**
 * @swagger
 * /files:
 *   get:
 *     summary: Get all uploaded file metadata for a user
 
 *     responses:
 *       200:
 *         description: A list of uploaded files
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 files:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       fileId:
 *                         type: string
 *                       fileName:
 *                         type: string
 *                       mimeType:
 *                         type: string
 *                       s3Key:
 *                         type: string
 *                       uploadedAt:
 *                         type: string
 *                         format: date-time
 *       500:
 *         description: Internal server error
 */
// Fetch all files from DynamoDB (no filter)
app.get('/files', async (req, res) => {
  try {
    const data = await dynamoDb.scan({
      TableName: process.env.DYNAMODB_TABLE
    }).promise();

    const encrypted = encryptData({ files: data.Items });
    res.json({ data: encrypted });
  } catch (err) {
    console.error('Error scanning files:', err);
    res.status(500).send('Could not fetch files');
  }
});


/**
 * @swagger
 * /files/{userId}:
 *   get:
 *     summary: Get all uploaded file metadata for a user
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the user to fetch files for
 *     responses:
 *       200:
 *         description: A list of uploaded files
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 files:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       fileId:
 *                         type: string
 *                       fileName:
 *                         type: string
 *                       mimeType:
 *                         type: string
 *                       s3Key:
 *                         type: string
 *                       uploadedAt:
 *                         type: string
 *                         format: date-time
 *       500:
 *         description: Internal server error
 */
// fetch the data from dynamoDB based on userId

app.get('/files/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const data = await dynamoDb.query({
      TableName: process.env.DYNAMODB_TABLE,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: {
        ':uid': userId
      }
    }).promise();

    res.json({ files: data.Items });
  } catch (err) {
    console.error('Error fetching files:', err);
    res.status(500).send('Could not fetch files');
  }
});
//  DELETE Route to Remove File Metadata from DynamoDB
/**
 * @swagger
 * /delete-record:
 *   delete:
 *     summary: Delete a file record from DynamoDB
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Record deleted successfully
 *       400:
 *         description: Bad request
 *       500:
 *         description: Internal server error
 */
app.delete('/delete-record', async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    // Check if item exists
    const existing = await dynamoDb.get({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { userId }
    }).promise();

    if (!existing.Item) {
      return res.status(404).json({ error: 'Record not found for the given userId' });
    }

    // Delete the item
    await dynamoDb.delete({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { userId }
    }).promise();

    res.json({ message: 'Record deleted from DynamoDB successfully' });
  } catch (err) {
    console.error('DynamoDB delete error:', err);
    res.status(500).json({ error: 'Failed to delete record from DynamoDB' });
  }
});

// Update Route to Modify File Metadata in DynamoDB
/**
 * @swagger
 * /files/{userId}:
 *   patch:
 *     summary: Update file metadata in DynamoDB
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the user to update files for
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
 *     responses:
 *       200:
 *         description: Record updated successfully
 *       400:
 *         description: Bad request
 */
app.patch("/files/:userId", async (req, res) => {
  const { userId } = req.params;
  const updateData = req.body;

  if (!updateData || Object.keys(updateData).length === 0) {
    return res.status(400).json({ message: "No update fields provided" });
  }

  let updateExp = "SET ";
  const expAttrValues = {};
  const expAttrNames = {};

  const updateClauses = Object.keys(updateData).map((key) => {
    const attrName = `#${key}`;
    const attrValue = `:${key}`;
    expAttrNames[attrName] = key;
    expAttrValues[attrValue] = updateData[key];
    return `${attrName} = ${attrValue}`;
  });

  updateExp += updateClauses.join(", ");

  const params = {
    TableName: process.env.DYNAMODB_TABLE,
    Key: { userId }, // Assumes userId is the partition key
    UpdateExpression: updateExp,
    ExpressionAttributeNames: expAttrNames,
    ExpressionAttributeValues: expAttrValues,
    ConditionExpression: "attribute_exists(userId)", // Optional, checks record exists
    ReturnValues: "ALL_NEW"
  };

  try {
    const result = await dynamoDb.update(params).promise();
    res.json({
      message: "Record updated successfully",
      updatedAttributes: result.Attributes
    });
  } catch (err) {
    console.error("DynamoDB update error:", err);
    res.status(500).json({ error: "Failed to update record", details: err.message });
  }
});


// Export app for use in handler

app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});

module.exports = app;

