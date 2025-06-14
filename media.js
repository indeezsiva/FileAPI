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
    message: "Hello from path! Health check File API is working!",
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


app.post('/multi-upload', upload.single('file'), async (req, res) => {
  try {
    const { fileName, mimeType, userId, resourceType = 'default' } = req.body;
    const file = req.file;

    // Validate required fields
    if (!fileName || !mimeType || !userId) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: {
          required: ['fileName', 'mimeType', 'userId'],
          received: {
            fileName: !!fileName,
            mimeType: !!mimeType,
            userId: !!userId,
          },
        },
      });
    }

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Generate unique identifiers
    const fileId = uuidv4(); // Unique file identifier (DynamoDB partition key)
    const fileExt = fileName.split('.').pop().toLowerCase();
    const sanitizedFileName = fileName
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9-.]/g, '');

    // Build S3 key
    const s3Key = `${process.env.APP_ENV}/${userId}/${resourceType}/${sanitizedFileName}`;

    // Upload to S3
    const uploadResult = await fileService.s3UploadMultiPart({
      Key: s3Key,
      Body: file.buffer,
      ContentType: mimeType,
    });

    // Create metadata object for DynamoDB
    const metadata = {
      fileId, // Partition key in DynamoDB
      userId,
      fileName: sanitizedFileName,
      mimeType,
      s3Key,
      uploadedAt: new Date().toISOString(),
      status: 'active',
      privacy: 'public',
      views: 0,
      likesCount: 0,
      commentsCount: 0,
      resourceType,
    };

    // Save metadata to DynamoDB with conditional check (optional safety)
    await dynamoDb
      .put({
        TableName: process.env.DYNAMODB_TABLE,
        Item: metadata,
        ConditionExpression: 'attribute_not_exists(fileId)', // prevents overwrite
      })
      .promise();

    // Respond with success
    return res.status(200).json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        fileId,
        s3Key,
        size: file.size,
        mimeType,
        location: uploadResult.Location, // AWS SDK v3 should still provide 'Location'
      },
    });
  } catch (error) {
    if (error.code === 'ConditionalCheckFailedException') {
      return res.status(409).json({
        error: 'File ID collision detected (rare)',
      });
    }

    console.error('Upload failed:', error);
    return res.status(500).json({
      success: false,
      error: 'File upload failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

app.patch("/multi-upload", upload.single("file"), async (req, res) => {
  const { fileName, mimeType, userId, resourceType = 'default', fileId, s3Key } = req.body;
  const file = req.file;

  if (!fileId) {
    return res.status(400).json({ error: "Missing required field: fileId" });
  }

  const updateData = { ...req.body };

  // Don't include keys that should not be updated
  delete updateData.fileId;

  // Validate
  if (Object.keys(updateData).length === 0 && !file) {
    return res.status(400).json({ message: "No update fields or file provided" });
  }

  // Step 1: Upload file to S3 if present
  if (file) {
    const ext = (fileName || file.originalname).split(".").pop().toLowerCase();

    const sanitizedFileName = fileName
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9-.]/g, '');
    const newS3Key = `${process.env.APP_ENV}/${userId}/${resourceType}/${sanitizedFileName}`;
    try {
      const uploadResult = await fileService.s3UploadMultiPart({
        Key: newS3Key,
        Body: file.buffer,
        ContentType: mimeType,
      });

      // Add to update payload
      updateData.s3Key = newS3Key;
      updateData.fileName = fileName;
      updateData.mimeType = mimeType;
      updateData.updatedAt = new Date().toISOString();
    } catch (uploadErr) {
      console.error("S3 upload failed during update:", uploadErr);
      return res.status(500).json({ error: "S3 upload failed", details: uploadErr.message });
    }
  }

  // Step 2: Update metadata in DynamoDB
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
    Key: { fileId }, // Partition key
    UpdateExpression: updateExp,
    ExpressionAttributeNames: expAttrNames,
    ExpressionAttributeValues: expAttrValues,
    ConditionExpression: "attribute_exists(fileId)",
    ReturnValues: "ALL_NEW",
  };

  try {
    const result = await dynamoDb.update(params).promise();
    res.json({
      message: "File and metadata updated successfully",
      updatedAttributes: result.Attributes,
    });
  } catch (dbErr) {
    console.error("DynamoDB Update Error:", dbErr);
    res.status(500).json({ error: "Failed to update metadata", details: dbErr.message });
  }
});




// // s3UploadMultiPart download file API

app.get('/download-multipart/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const { userId } = req.query;

    // 1. Get file metadata from DynamoDB
    const file = await dynamoDb.get({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { fileId }
    }).promise();
    if (!file.Item) {
      return res.status(404).json({ error: 'File not found' });
    }

    // 2. Get file size from S3 headObject
    const { ContentLength: fileSize } = await s3.headObject({
      Bucket:BUCKET,
      Key: file.Item.s3Key
    }).promise();

    // 3. Calculate parts (e.g., 10MB chunks)
    const PART_SIZE = 10 * 1024 * 1024; // 10MB
    const partCount = Math.ceil(fileSize / PART_SIZE);
    const downloadId = uuidv4();

    // 4. Generate pre-signed URLs for each part
    const parts = [];
    for (let i = 0; i < partCount; i++) {
      const startByte = i * PART_SIZE;
      const endByte = Math.min(startByte + PART_SIZE - 1, fileSize - 1);

      const url = await s3.getSignedUrlPromise('getObject', {
        Bucket: BUCKET,
        Key: file.Item.s3Key,
        ResponseContentDisposition: `attachment; filename="${file.Item.fileName}"`,
        ResponseContentType: file.Item.mimeType,
        Expires: 3600, // 1 hour expiry
        Range: `bytes=${startByte}-${endByte}`
      });

      parts.push({
        partNumber: i + 1,
        startByte,
        endByte,
        url
      });
    }

    res.json({
      downloadId,
      fileName: file.Item.fileName,
      mimeType: file.Item.mimeType,
      fileSize,
      partSize: PART_SIZE,
      parts
    });

  } catch (error) {
    console.error('Download init failed:', error);
    res.status(500).json({ 
      error: 'Download failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// // s3UploadMultiPart Upload file API
// app.post('/multi-upload', upload.single('file'), async (req, res) => {
//   const { fileName, mimeType, userId, resourceType } = req.body;

//   if (!fileName || !mimeType || !userId) {
//     return res.status(400).json({ error: 'fileName, mimeType, and userId are required' });
//   }
//   const fileId = uuidv4();
//   const timestamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
//   const s3Key = `${env}/${resourceType}/${userId}/${fileName}`;
//     try {
//         const file = req.file;
//         const s3Key = `${env}/${resourceType}/${userId}/${fileName}`;
//         // We call the s3UploadMultiPart function for upload our file
//         await fileService.s3UploadMultiPart({
//             Key: s3Key,
//             Body: file.buffer,
//         });

//         res.status(200).send('File uploaded successfully');
//     } catch (error) {
//         console.error(error);
//         res.status(500).send('File upload failed');
//     }
// });


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
    res.json({ data: data.Items });
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

app.get('/files/:fileId', async (req, res) => {
  const { fileId } = req.params;

  try {
    const data = await dynamoDb.query({
      TableName: process.env.DYNAMODB_TABLE,
      KeyConditionExpression: 'fileId = :uid',
      ExpressionAttributeValues: {
        ':uid': fileId
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
  const { fileId } = req.body;

  if (!fileId) {
    return res.status(400).json({ error: 'fileId is required' });
  }

  try {
    // Check if item exists
    const existing = await dynamoDb.get({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { fileId }
    }).promise();

    if (!existing.Item) {
      return res.status(404).json({ error: 'Record not found for the given fileId' });
    }

    // Delete the item
    await dynamoDb.delete({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { fileId }
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
app.patch("/files/:fileId", async (req, res) => {
  const { fileId } = req.params;
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
    Key: { fileId }, // Assumes userId is the partition key
    UpdateExpression: updateExp,
    ExpressionAttributeNames: expAttrNames,
    ExpressionAttributeValues: expAttrValues,
    ConditionExpression: "attribute_exists(fileId)", // Optional, checks record exists
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


// // Export app for use in handler

// if (process.env.ENVIRONMENT === 'lambda') {
// 	module.exports.handler = serverless(app)
// } else {
// 	app.listen(PORT, () => {
// 		console.log(`Server listening on ${PORT}`);
// 	});
// }
module.exports = app;

