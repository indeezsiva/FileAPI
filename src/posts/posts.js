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

const POSTS_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_POSTS}`;
const USERS_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_USERS}`;
const COMMENTS_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_COMMENTS}`;
const REACTIONS_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_REACTIONS}`;
const ENV_AWS_BUCKET_NAME = `${APP_ENV}-${AWS_BUCKET_NAME}`;
const USER_FOLLOW_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_USERS_FOLLOWS}`;
const IMAGE_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_IMAGE}`;
const VIDEO_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_VIDEO}`;
const AUDIO_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_AUDIO}`;
const PLAYLISTS_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_PLAYLISTS}`;


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
    message: "Hello from path! Health check POST API is working!",
  });
});

// create-post API, creates a new post, if the res type is text, it will create a text post, if the resource type is media, it will create a media post
/**
 * @swagger
 * /create-post:
 *   post:
 *     summary: Create a new post
 *     tags: [Posts]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *                 description: User ID of the post creator
 *               content:
 *                 type: string
 *                 description: Text content of the post (optional)
 *               fileName:
 *                 type: string
 *                 description: Name of the file being uploaded (optional)
 *               mimeType:
 *                 type: string
 *                 description: MIME type of the file being uploaded (optional)
 *               resourceType:
 *                 type: string
 *                 description: Type of resource (e.g., "image", "video", "text")
 *               privacy:
 *                 type: string
 *                 description: Privacy setting for the post (default is "public")
 *     responses:
 *       201:
 *         description: Post created successfully
 */

// app.post('/create-post', upload.single('file'), async (req, res) => {
//   try {
//     const {
//       userId,
//       content, // For text-based posts
//       fileName,
//       mimeType,
//       resourceType = 'default', // e.g., "image", "video", "text", etc.
//       privacy = 'public',
//     } = req.body;

//     // Validate required fields
//     if (!userId || (!req.file && !content)) {
//       return res.status(400).json({
//         error: 'Missing required fields',
//         details: {
//           required: ['userId', 'file OR content'],
//           received: {
//             userId: !!userId,
//             file: !!req.file,
//             content: !!content,
//           },
//         },
//       });
//     }

//     // Step 1: Check if user exists in Users table
//     const userCheck = await dynamoDb
//       .get({
//         TableName: USERS_TABLE,
//         Key: { userId },
//       })
//       .promise();

//     if (!userCheck.Item) {
//       return res.status(404).json({
//         success: false,
//         error: 'Invalid userId. User not found.',
//       });
//     }

//     const postId = uuidv4();
//     const createdAt = new Date().toISOString();

//     let post = {
//       postId,
//       userId,
//       createdAt,
//       resourceType,
//       status: 'active',
//       privacy,
//       views: 0,
//       likesCount: 0,
//       commentsCount: 0,
//     };

//     // Step 2: Handle media file if present
//     if (req.file) {
//       const file = req.file;
//       const fileExt = fileName.split('.').pop().toLowerCase();
//       const sanitizedFileName = fileName
//         .replace(/\s+/g, '-')
//         .replace(/[^a-zA-Z0-9-.]/g, '');

//       const s3Key = `${process.env.APP_ENV}/${userId}/${resourceType}/${sanitizedFileName}`;

//       const uploadResult = await fileService.s3UploadMultiPart({
//         Key: s3Key,
//         Body: file.buffer,
//         ContentType: mimeType,
//       });

//       post = {
//         ...post,
//         postType: resourceType,
//         fileName: sanitizedFileName,
//         mimeType,
//         s3Key,
//         mediaUrl: uploadResult.Location,
//       };
//     }

//     // Step 3: If content is text-only
//     if (!req.file && content) {
//       post = {
//         ...post,
//         postType: resourceType,
//         content,
//       };
//     }
//     // Initialize filters to check for profanity
//     // Using 'bad-words' library for profanity filtering
//     const { Filter } = await import('bad-words');
//     const filter = new Filter();

//     // Profanity filter (applies to text content only)
//     if (content) {
//       const hasProfanity = filter.isProfane(content) // addother profanity check libraries

//       if (hasProfanity) {
//         return res.status(400).json({
//           success: false,
//           error: 'Content contains inappropriate language.',
//         });
//       }
//     }

//     // Step 4: Save post to DynamoDB
//     await dynamoDb
//       .put({
//         TableName: POSTS_TABLE,
//         Item: post,
//         ConditionExpression: 'attribute_not_exists(postId)',
//       })
//       .promise();

//     return res.status(201).json({
//       success: true,
//       message: 'Post created successfully',
//       data: post,
//     });
//   } catch (error) {
//     console.error('Post creation failed:', error);
//     return res.status(500).json({
//       success: false,
//       error: 'Post creation failed',
//       details: process.env.NODE_ENV === 'development' ? error.message : undefined,
//     });
//   }
// });


// Configuration

app.post('/create-post/text', async (req, res) => {
  try {
    const { userId, content, posttitle, resourceType = 'text', privacy = 'public' } = req.body;

    if (!userId || !content || !posttitle) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: {
          required: ['userId', 'content', 'posttitle'
          ]
        },
      });
    }

    const userCheck = await dynamoDb.get({
      TableName: USERS_TABLE,
      Key: { userId },
    }).promise();

    if (!userCheck.Item) {
      return res.status(404).json({ success: false, error: 'Invalid userId. User not found.' });
    }

    const { Filter } = await import('bad-words');
    const filter = new Filter();

    if (content && filter.isProfane(content)) {
      return res.status(400).json({ success: false, error: 'Content contains inappropriate language.' });
    }

    if (posttitle && filter.isProfane(posttitle)) {
      return res.status(400).json({ success: false, error: 'Title contains inappropriate language.' });
    }

    const postId = 'post-text-' + uuidv4();
    const createdAt = new Date().toISOString();

    const post = {
      postId,
      userId,
      createdAt,
      resourceType,
      posttitle,
      content,
      privacy,
      status: 'active',
      views: 0,
      commentsCount: 0,
      active: true
    };

    await dynamoDb.put({
      TableName: POSTS_TABLE,
      Item: post,
      ConditionExpression: 'attribute_not_exists(postId)',
    }).promise();

    return res.status(201).json({ success: true, message: 'Text post created', data: post });

  } catch (error) {
    console.error('Text post creation failed:', error);
    return res.status(500).json({ success: false, error: 'Text post creation failed' });
  }
});
app.post('/create-post/media', upload.single('file'), async (req, res) => {
  try {
    const {
      userId,
      fileName,
      mimeType,
      resourceType = 'media',
      privacy = 'public',
      content,
      posttitle,
    } = req.body;

    const file = req.file;
    console.log('Received file:', file);

    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_FILE_SIZE) {
      return res.status(400).json({
        error: 'File size exceeds limit',
        maxAllowedSize: `${MAX_FILE_SIZE / (1024 * 1024)} MB`,
        receivedSize: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
      });
    }
    if (!userId || !file || !fileName || !mimeType || !posttitle || !resourceType) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: { required: ['userId', 'file', 'fileName', 'mimeType', 'posttitle', 'resourceType'] },
      });
    }

    const userCheck = await dynamoDb.get({
      TableName: USERS_TABLE,
      Key: { userId },
    }).promise();

    if (!userCheck.Item) {
      return res.status(404).json({ success: false, error: 'Invalid userId. User not found.' });
    }

    const { Filter } = await import('bad-words');
    const filter = new Filter();
    if (posttitle && filter.isProfane(posttitle)) {
      return res.status(400).json({ success: false, error: 'Title contains inappropriate language.' });
    }
    if (content && filter.isProfane(content)) {
      return res.status(400).json({ success: false, error: 'Content contains inappropriate language.' });
    }

    // const postId = uuidv4();
    const postId = `post-${resourceType}-` + uuidv4();
    const createdAt = new Date().toISOString();

    const sanitizedFileName = fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
    const s3Key = `${process.env.APP_ENV}/${userId}/${resourceType}/${sanitizedFileName}`;

    const uploadResult = await fileService.s3UploadMultiPart({
      Key: s3Key,
      Body: file.buffer,
      ContentType: mimeType,
    });

    const post = {
      postId,
      userId,
      createdAt,
      resourceType,
      fileName: sanitizedFileName,
      content: content || null,
      posttitle,
      mimeType,
      s3Key,
      mediaUrl: uploadResult.Location,
      privacy,
      status: 'active',
      views: 0,
      commentsCount: 0,
      active: true
    };
    console.log('mediaUrl:', uploadResult);
    await dynamoDb.put({
      TableName: POSTS_TABLE,
      Item: post,
      ConditionExpression: 'attribute_not_exists(postId)',
    }).promise();

    return res.status(201).json({ success: true, message: 'Media post created', data: post });

  } catch (error) {
    console.error('Media post creation failed:', error);
    return res.status(500).json({ success: false, error: 'Media post creation failed' });
  }
});
// single media upload API, creates a new post with a single media file
app.post('/create-post/large-media', upload.none(), async (req, res) => {

  try {
    const {
      userId,
      fileName,
      mimeType,
      resourceType,
      privacy = 'public',
      content,
      posttitle,
    } = req.body;
    console.log('Received body:', req.body);
    if (!userId || !fileName || !mimeType || !posttitle || !resourceType) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: { required: ['userId', 'fileName', 'mimeType', 'posttitle', 'resourceType'] },
      });
    }

    const userCheck = await dynamoDb.get({
      TableName: USERS_TABLE,
      Key: { userId },
    }).promise();

    if (!userCheck.Item) {
      return res.status(404).json({ success: false, error: 'Invalid userId. User not found.' });
    }

    const { Filter } = await import('bad-words');
    const filter = new Filter();
    if (posttitle && filter.isProfane(posttitle)) {
      return res.status(400).json({ success: false, error: 'Title contains inappropriate language.' });
    }
    if (content && filter.isProfane(content)) {
      return res.status(400).json({ success: false, error: 'Content contains inappropriate language.' });
    }

    const postId = `post-${resourceType}-` + uuidv4();
    const createdAt = new Date().toISOString();

    const sanitizedFileName = fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
    const s3Key = `${process.env.APP_ENV}/${userId}/${resourceType}/${sanitizedFileName}`;

    const uploadUrl = s3.getSignedUrl('putObject', {
      Bucket: ENV_AWS_BUCKET_NAME,
      Key: s3Key,
      ContentType: mimeType,
      Expires: 60 * 5,
    });

    const post = {
      postId,
      userId,
      createdAt,
      resourceType,
      fileName: sanitizedFileName,
      content: content || null,
      posttitle,
      mimeType,
      s3Key,
      mediaUrl: `https://${ENV_AWS_BUCKET_NAME}.s3.amazonaws.com/${s3Key}`,
      privacy,
      status: 'pending_upload',
      views: 0,
      commentsCount: 0,
      active: true
    };

    await dynamoDb.put({
      TableName: POSTS_TABLE,
      Item: post,
      ConditionExpression: 'attribute_not_exists(postId)',
    }).promise();

    return res.status(200).json({
      success: true,
      message: 'Pre-signed URL generated',
      uploadUrl,
      s3Key,
      postId,
      postData: post,
    });

  } catch (error) {
    console.error('Pre-signed URL generation failed:', error);
    return res.status(500).json({ success: false, error: 'Upload URL generation failed' });
  }
});



app.post('/create-post/large-mediav2', upload.none(), async (req, res) => {
  try {
    const {
      userId,
      posttitle,
      content,
      resourceType,
      privacy = 'public',
    } = req.body;

    let files = req.body.files;

    // Ensure 'files' is parsed correctly (from JSON string if needed)
    if (typeof files === 'string') {
      try {
        files = JSON.parse(files);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid files JSON format' });
      }
    }

    if (!userId || !posttitle || !resourceType || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: { required: ['userId', 'posttitle', 'resourceType', 'files (array)'] },
      });
    }
    //  Normalize/fix indexes
    const seen = new Set();
    let nextIndex = 0;

    files = files.map((file) => {
      let idx = Number(file.index);
      if (isNaN(idx) || seen.has(idx)) {
        while (seen.has(nextIndex)) nextIndex++;
        idx = nextIndex++;
      }
      seen.add(idx);
      return { ...file, index: idx };
    });
    // User validation
    const userCheck = await dynamoDb.get({
      TableName: USERS_TABLE,
      Key: { userId },
    }).promise();
    if (!userCheck.Item) {
      return res.status(404).json({ success: false, error: 'Invalid userId. User not found.' });
    }

    const { Filter } = await import('bad-words');
    const filter = new Filter();
    if (filter.isProfane(posttitle)) {
      return res.status(400).json({ success: false, error: 'Title contains inappropriate language.' });
    }
    if (content && filter.isProfane(content)) {
      return res.status(400).json({ success: false, error: 'Content contains inappropriate language.' });
    }

    const postId = `post-${resourceType}-` + uuidv4();
    const createdAt = new Date().toISOString();

    const imageMetaList = [];

    for (const file of files) {
      const sanitizedFileName = file.fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
      const s3Key = `${process.env.APP_ENV}/${userId}/${resourceType}/${postId}/${sanitizedFileName}`;

      const uploadUrl = s3.getSignedUrl('putObject', {
        Bucket: ENV_AWS_BUCKET_NAME,
        Key: s3Key,
        ContentType: file.mimeType,
        Expires: 60 * 5,
      });

      imageMetaList.push({
        fileName: sanitizedFileName,
        mimeType: file.mimeType,
        s3Key,
        mediaUrl: `https://${ENV_AWS_BUCKET_NAME}.s3.amazonaws.com/${s3Key}`,
        uploadUrl,
        index: file.index ?? null,
        status: 'pending'
      });
    }

    const post = {
      postId,
      userId,
      createdAt,
      resourceType,
      posttitle,
      content: content || null,
      mediaItems: imageMetaList.map(({ fileName, mimeType, s3Key, mediaUrl, index, status }) => ({
        fileName,
        mimeType,
        s3Key,
        mediaUrl,
        index,
        status
      })),
      privacy,
      status: 'pending_upload',
      views: 0,
      commentsCount: 0,
      active: true
    };

    await dynamoDb.put({
      TableName: POSTS_TABLE,
      Item: post,
      ConditionExpression: 'attribute_not_exists(postId)',
    }).promise();

    return res.status(200).json({
      success: true,
      message: 'Pre-signed URLs generated',
      postId,
      mediaUploadUrls: imageMetaList.map(({ uploadUrl, fileName }) => ({ uploadUrl, fileName })),
      postData: post,
    });

  } catch (error) {
    console.error('Pre-signed URL generation failed:', error);
    return res.status(500).json({ success: false, error: 'Upload URL generation failed' });
  }
});


// update-post/large-mediav2 API, updates an existing post with new media items
// // app.patch('/update-post/large-mediav2/:postId', upload.none(), async (req, res) => {
// app.patch('/update-post/large-mediav2/:postId', async (req, res) => {
//   try {
//     const { postId } = req.params;
//     const {
//       userId,
//       posttitle,
//       content,
//       privacy,
//       resourceType,
//       files,
//     } = req.body;

//     if (!postId || !userId) {
//       return res.status(400).json({ error: 'Missing required fields: postId, userId' });
//     }

//     // 1. Fetch post
//     const result = await dynamoDb.get({
//       TableName: POSTS_TABLE,
//       Key: { postId },
//     }).promise();

//     const post = result.Item;
//     if (!post || post.userId !== userId) {
//       return res.status(404).json({ error: 'Post not found or unauthorized' });
//     }

//     // 2. Profanity check
//     const { Filter } = await import('bad-words');
//     const filter = new Filter();
//     if (posttitle && filter.isProfane(posttitle)) {
//       return res.status(400).json({ error: 'Title contains inappropriate language' });
//     }
//     if (content && filter.isProfane(content)) {
//       return res.status(400).json({ error: 'Content contains inappropriate language' });
//     }

//     // 3. Prepare metadata updates
//     const metadataUpdates = {};
//     if (posttitle) metadataUpdates.posttitle = posttitle;
//     if (content) metadataUpdates.content = content;
//     if (privacy) metadataUpdates.privacy = privacy;
//     if (resourceType && resourceType !== post.resourceType) {
//       return res.status(400).json({ error: 'resourceType cannot be changed once set' });
//     }
//     metadataUpdates.updatedAt = new Date().toISOString();

//     // 4. Update media files if provided
//     let updatedMediaItems = [...(post.mediaItems || [])];

//     if (Array.isArray(files) && files.length > 0) {
//       // Normalize/fix indexes
//       const seen = new Set();
//       let nextIndex = 0;
//       const normalizedFiles = files.map((file) => {
//         let idx = Number(file.index);
//         if (isNaN(idx) || seen.has(idx)) {
//           while (seen.has(nextIndex)) nextIndex++;
//           idx = nextIndex++;
//         }
//         seen.add(idx);
//         return { ...file, index: idx };
//       });

//       for (const file of normalizedFiles) {
//         const sanitizedFileName = file.fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
//         const s3Key = `${process.env.APP_ENV}/${userId}/${post.resourceType}/${postId}/${sanitizedFileName}`;
//         const mediaUrl = `https://${ENV_AWS_BUCKET_NAME}.s3.amazonaws.com/${s3Key}`;

//         const uploadUrl = s3.getSignedUrl('putObject', {
//           Bucket: ENV_AWS_BUCKET_NAME,
//           Key: s3Key,
//           ContentType: file.mimeType,
//           Expires: 60 * 5,
//         });

//         const newMedia = {
//           fileName: sanitizedFileName,
//           mimeType: file.mimeType,
//           s3Key,
//           mediaUrl,
//           status: 'pending',
//           index: file.index,
//         };

//         // Replace if file with same index exists
//         const idx = updatedMediaItems.findIndex((item) => item.index === file.index);
//         if (idx !== -1) {
//           updatedMediaItems[idx] = newMedia;
//         } else {
//           updatedMediaItems.push(newMedia);
//         }

//         // Return upload URLs for each file
//         file.uploadUrl = uploadUrl;
//       }
//     }

//     // 5. Final updated post object
//     const updatedPost = {
//       ...post,
//       ...metadataUpdates,
//       mediaItems: updatedMediaItems,
//     };

//     await dynamoDb.put({
//       TableName: POSTS_TABLE,
//       Item: updatedPost,
//     }).promise();

//     return res.status(200).json({
//       success: true,
//       message: 'Post updated successfully',
//       postId,
//       updatedPost,
//       uploadUrls: (files || []).map(({ fileName, uploadUrl }) => ({ fileName, uploadUrl })),
//     });
//   } catch (err) {
//     console.error('PATCH /update-post/large-mediav2 error:', err);
//     return res.status(500).json({ error: 'Internal server error' });
//   }
// });

app.patch('/update-post/large-mediav2/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    const {
      userId,
      posttitle,
      content,
      privacy,
      files,
      index,
      fileName,
      status
    } = req.body;

    if (!postId || !userId) {
      return res.status(400).json({ error: 'Missing required fields: postId, userId' });
    }

    // 1. Fetch post
    const result = await dynamoDb.get({
      TableName: POSTS_TABLE,
      Key: { postId }
    }).promise();

    const post = result.Item;
    if (!post || post.userId !== userId) {
      return res.status(404).json({ error: 'Post not found or unauthorized' });
    }

    // 2. Profanity filter for metadata
    const { Filter } = await import('bad-words');
    const filter = new Filter();
    if (posttitle && filter.isProfane(posttitle)) {
      return res.status(400).json({ error: 'Title contains inappropriate language' });
    }
    if (content && filter.isProfane(content)) {
      return res.status(400).json({ error: 'Content contains inappropriate language' });
    }

    // 3. Update post metadata if provided
    if (posttitle) post.posttitle = posttitle;
    if (content) post.content = content;
    if (privacy) post.privacy = privacy;
    post.updatedAt = new Date().toISOString();

    // 4. Update media status if provided
    if (status && (index !== undefined || fileName)) {
      post.mediaItems = post.mediaItems.map(item => {
        const match =
          (index !== undefined && item.index === Number(index)) ||
          (fileName && item.fileName === fileName);
        return match ? { ...item, status } : item;
      });
    }

    // 5. Add or replace media files if files are present
    let uploadUrls = [];
    if (Array.isArray(files) && files.length > 0) {
      const seen = new Set();
      let nextIndex = 0;

      const normalizedFiles = files.map(file => {
        let idx = Number(file.index);
        if (isNaN(idx) || seen.has(idx)) {
          while (seen.has(nextIndex)) nextIndex++;
          idx = nextIndex++;
        }
        seen.add(idx);
        return { ...file, index: idx };
      });

      for (const file of normalizedFiles) {
        const sanitizedFileName = file.fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
        const s3Key = `${process.env.APP_ENV}/${userId}/${post.resourceType}/${postId}/${sanitizedFileName}`;
        const mediaUrl = `https://${ENV_AWS_BUCKET_NAME}.s3.amazonaws.com/${s3Key}`;

        const uploadUrl = s3.getSignedUrl('putObject', {
          Bucket: ENV_AWS_BUCKET_NAME,
          Key: s3Key,
          ContentType: file.mimeType,
          Expires: 60 * 5,
        });

        const newItem = {
          fileName: sanitizedFileName,
          mimeType: file.mimeType,
          s3Key,
          mediaUrl,
          status: 'pending',
          index: file.index
        };

        // Replace if index already exists, else push
        const existingIndex = post.mediaItems.findIndex(item => item.index === file.index);
        if (existingIndex !== -1) {
          post.mediaItems[existingIndex] = newItem;
        } else {
          post.mediaItems.push(newItem);
        }

        uploadUrls.push({ fileName: sanitizedFileName, uploadUrl });
      }
    }

    // 6. Final update to DynamoDB
    await dynamoDb.put({
      TableName: POSTS_TABLE,
      Item: post
    }).promise();

    return res.status(200).json({
      success: true,
      message: 'Post updated successfully',
      postId,
      updatedPost: post,
      uploadUrls
    });

  } catch (err) {
    console.error('PATCH /update-post/large-mediav2 error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});




// update-post/text API, updates an existing text post
app.patch('/update-post/text/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    const { userId, ...updates } = req.body;

    if (!postId || !userId) {
      return res.status(400).json({ error: 'Missing required fields: postId or userId' });
    }

    const post = await dynamoDb.get({
      TableName: POSTS_TABLE,
      Key: { postId },
    }).promise();

    if (!post.Item) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    if (post.Item.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized user' });
    }
    const { Filter } = await import('bad-words');
    const filter = new Filter();
    // check profanity 
    if (updates.posttitle) {
      if (filter.isProfane(updates.posttitle)) {
        return res.status(400).json({ success: false, error: 'Title contains inappropriate language.' });
      }
    }
    if (updates.content) {

      if (filter.isProfane(updates.content)) {
        return res.status(400).json({ success: false, error: 'Content contains inappropriate language.' });
      }
    }

    // Add updatedAt timestamp
    updates.updatedAt = new Date().toISOString();

    const updatedPost = {
      ...post.Item,
      ...updates,
    };

    await dynamoDb.put({
      TableName: POSTS_TABLE,
      Item: updatedPost,
    }).promise();

    res.json({ success: true, message: 'Text post updated successfully', data: updatedPost });

  } catch (error) {
    console.error('Update text post error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});



app.patch('/update-post/media/:postId', upload.single('file'), async (req, res) => {
  try {
    const { postId } = req.params;
    const { userId, ...updates } = req.body;
    const file = req.file;
    if (!postId || !userId || !updates.fileName || !updates.mimeType || !updates.resourceType || !file) {
      return res.status(400).json({ error: 'Missing required fields for media update' });
    }
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_FILE_SIZE) {
      return res.status(400).json({
        error: 'File size exceeds limit',
        maxAllowedSize: `${MAX_FILE_SIZE / (1024 * 1024)} MB`,
        receivedSize: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
      });
    }
    const post = await dynamoDb.get({
      TableName: POSTS_TABLE,
      Key: { postId },
    }).promise();

    if (!post.Item) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.Item.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized user' });
    }

    const sanitizedFileName = updates.fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
    const olds3Key = post.Item.s3Key || null;
    const s3Key = `${process.env.APP_ENV}/${userId}/${updates.resourceType}/${sanitizedFileName}`;

    // Delete old file if exists
    if (post.Item.s3Key) {
      try {
        await fileService.s3DeleteObject({ Key: post.Item.s3Key });
      } catch (err) {
        console.warn('S3 delete failed:', err);
      }
    }

    const uploadResult = await fileService.s3UploadMultiPart({
      Key: s3Key,
      Body: file.buffer,
      ContentType: updates.mimeType,
    });

    updates.s3Key = s3Key;
    updates.updatedAt = new Date().toISOString();
    updates.mediaUrl = uploadResult.Location;

    const updatedPost = {
      ...post.Item,
      ...updates,
    };
    await dynamoDb.put({
      TableName: POSTS_TABLE,
      Item: updatedPost,
    }).promise();

    res.json({
      success: true,
      message: 'Media metadata updated',
      data: updatedPost,
    });

  } catch (error) {
    console.error('Update media post error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});


app.patch('/update-post/large-media/:postId', upload.none(), async (req, res) => {
  try {
    const { postId } = req.params;
    const { userId, ...updates } = req.body;

    if (!postId || !userId || !updates.fileName || !updates.mimeType || !updates.resourceType) {
      return res.status(400).json({ error: 'Missing required fields for media update' });
    }

    const post = await dynamoDb.get({
      TableName: POSTS_TABLE,
      Key: { postId },
    }).promise();

    if (!post.Item) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.Item.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized user' });
    }

    const sanitizedFileName = updates.fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
    const s3Key = `${process.env.APP_ENV}/${userId}/${updates.resourceType}/${sanitizedFileName}`;

    // Delete old file if exists
    if (post.Item.s3Key) {
      try {
        await fileService.s3DeleteObject({ Key: post.Item.s3Key });
      } catch (err) {
        console.warn('S3 delete failed:', err);
      }
    }

    const presignedUrl = s3.getSignedUrl('putObject', {
      Bucket: BUCKET,
      Key: s3Key,
      ContentType: updates.mimeType,
      Expires: 60 * 10, // longer time for large files
    });
    updates.s3Key = s3Key;
    updates.updatedAt = new Date().toISOString();

    const updatedPost = {
      ...post.Item,
      ...updates,
    };

    await dynamoDb.put({
      TableName: POSTS_TABLE,
      Item: updatedPost,
    }).promise();

    res.json({
      success: true,
      message: 'Large file metadata updated',
      data: updatedPost,
      uploadUrl: presignedUrl,
    });

  } catch (error) {
    console.error('Update large file post error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});
// // update-post/metadata API, updates metadata of a post without changing the resourceType
app.patch('/update-post/metadata/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    const { userId, ...updates } = req.body;

    if (!postId || !userId) {
      return res.status(400).json({ error: 'Missing required fields: postId and userId' });
    }

    // Fields that should not be modified directly via metadata update
    const forbiddenFields = ['fileName', 'resourceType', 'mimeType', 'mediaItems', 'postId', 'userId'];
    for (const field of forbiddenFields) {
      if (field in updates) {
        return res.status(400).json({ error: `Field '${field}' cannot be modified.` });
      }
    }

    const result = await dynamoDb.get({
      TableName: POSTS_TABLE,
      Key: { postId },
    }).promise();

    const post = result.Item;

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized user' });
    }

    // (Optional) Profanity filter for content/title
    const { Filter } = await import('bad-words');
    const filter = new Filter();
    if (updates.posttitle && filter.isProfane(updates.posttitle)) {
      return res.status(400).json({ error: 'Title contains inappropriate language' });
    }
    if (updates.content && filter.isProfane(updates.content)) {
      return res.status(400).json({ error: 'Content contains inappropriate language' });
    }

    // Update timestamp
    updates.updatedAt = new Date().toISOString();

    const updatedPost = {
      ...post,
      ...updates,
    };

    await dynamoDb.put({
      TableName: POSTS_TABLE,
      Item: updatedPost,
    }).promise();

    return res.status(200).json({
      success: true,
      message: 'Post metadata updated successfully',
      data: updatedPost,
    });

  } catch (error) {
    console.error('Update post metadata error:', error);
    res.status(500).json({ error: 'Internal server error' });
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
    // 1. Fetch the post first
    const { Item: post } = await dynamoDb.get({
      TableName: POSTS_TABLE,
      Key: { postId },
    }).promise();

    if (!post) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    // 2. Delete media from S3 (if any)
    const objectsToDelete = [];

    if (post.resourceType !== 'text' && post.s3Key) {
      objectsToDelete.push({ Key: post.s3Key });
    }

    if (objectsToDelete.length > 0) {
      await s3.deleteObjects({
        Bucket: BUCKET,
        Delete: { Objects: objectsToDelete },
      }).promise();
    }

    // 3. Delete all comments and replies for this post
    const commentResult = await dynamoDb.query({
      TableName: COMMENTS_TABLE,
      IndexName: 'PostIdIndex',
      KeyConditionExpression: 'postId = :pid',
      ExpressionAttributeValues: {
        ':pid': postId
      }
    }).promise();

    const allComments = commentResult.Items || [];

    if (allComments.length > 0) {
      const commentDeleteBatches = [];

      for (let i = 0; i < allComments.length; i += 25) {
        const batch = allComments.slice(i, i + 25).map(comment => ({
          DeleteRequest: {
            Key: { commentId: comment.commentId }
          }
        }));

        commentDeleteBatches.push(batch);
      }

      for (const batch of commentDeleteBatches) {
        await dynamoDb.batchWrite({
          RequestItems: {
            [COMMENTS_TABLE]: batch
          }
        }).promise();
      }
    }

    // 4. Delete all reactions on this post
    const reactionResult = await dynamoDb.scan({
      TableName: REACTIONS_TABLE,
      FilterExpression: 'postId = :pid',
      ExpressionAttributeValues: {
        ':pid': postId
      }
    }).promise();

    const postReactions = reactionResult.Items || [];

    if (postReactions.length > 0) {
      const reactionDeleteBatches = [];

      for (let i = 0; i < postReactions.length; i += 25) {
        const batch = postReactions.slice(i, i + 25).map(reaction => ({
          DeleteRequest: {
            Key: { reactionId: reaction.reactionId }
          }
        }));

        reactionDeleteBatches.push(batch);
      }

      for (const batch of reactionDeleteBatches) {
        await dynamoDb.batchWrite({
          RequestItems: {
            [REACTIONS_TABLE]: batch
          }
        }).promise();
      }
    }

    // 5. Delete the post itself
    await dynamoDb.delete({
      TableName: POSTS_TABLE,
      Key: { postId },
      ConditionExpression: 'attribute_exists(postId)',
    }).promise();

    return res.status(200).json({
      success: true,
      message: `Post deleted along with ${allComments.length} comments and ${postReactions.length} reactions.`,
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


// get-post API, retrieves a specific post by postId

app.get('/:postId', async (req, res) => {
  const { postId } = req.params;

  if (!postId) {
    return res.status(400).json({ success: false, error: 'Missing postId' });
  }

  try {
    // 1. Get post
    const result = await dynamoDb.get({
      TableName: POSTS_TABLE,
      Key: { postId }
    }).promise();

    if (!result.Item) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    // 2. Count comments using PostIdIndex
    const commentResult = await dynamoDb.query({
      TableName: COMMENTS_TABLE,
      IndexName: 'PostIdIndex',
      KeyConditionExpression: 'postId = :pid',
      ExpressionAttributeValues: {
        ':pid': postId
      },
      Select: 'COUNT'
    }).promise();

    const commentsCount = commentResult.Count || 0;

    // 3. Get reactions for the post
    const reactionResult = await dynamoDb.scan({
      TableName: REACTIONS_TABLE,
      FilterExpression: 'postId = :pid',
      ExpressionAttributeValues: {
        ':pid': postId
      }
    }).promise();

    const reactions = reactionResult.Items || [];

    // 4. Grouped reactions count
    const reactionsCount = reactions.reduce((acc, r) => {
      acc[r.reactionType] = (acc[r.reactionType] || 0) + 1;
      return acc;
    }, {});

    // 5. Total reactions
    const totalReactions = Object.values(reactionsCount).reduce((sum, count) => sum + count, 0);

    // 6. Send response
    return res.status(200).json({
      success: true,
      data: {
        ...result.Item,
        commentsCount,
        reactionsCount,
        totalReactions
      }
    });


  } catch (error) {
    console.error('Failed to get post:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve post' });
  }
});

// get-user-posts API, retrieves all posts by a specific userId using a GSI (Global Secondary Index)
app.get('/', async (req, res) => {
  const { userId, limit = 20, lastEvaluatedKey } = req.query;

  let params;

  if (userId) {
    params = {
      TableName: POSTS_TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: {
        ':uid': userId,
      },
      Limit: Number(limit),
      ScanIndexForward: false,
    };
  } else {
    params = {
      TableName: POSTS_TABLE,
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

    const enrichedPosts = await Promise.all(result.Items.map(async (post) => {
      const postId = post.postId;

      // 1. Comments count
      const commentResult = await dynamoDb.query({
        TableName: COMMENTS_TABLE,
        IndexName: 'PostIdIndex',
        KeyConditionExpression: 'postId = :pid',
        ExpressionAttributeValues: { ':pid': postId },
        Select: 'COUNT'
      }).promise();
      const commentsCount = commentResult.Count || 0;

      // 2. Reactions
      const reactionResult = await dynamoDb.scan({
        TableName: REACTIONS_TABLE,
        FilterExpression: 'postId = :pid',
        ExpressionAttributeValues: { ':pid': postId }
      }).promise();

      const reactions = reactionResult.Items || [];
      const reactionsCount = reactions.reduce((acc, r) => {
        acc[r.reactionType] = (acc[r.reactionType] || 0) + 1;
        return acc;
      }, {});
      const totalReactions = Object.values(reactionsCount).reduce((sum, c) => sum + c, 0);

      return {
        ...post,
        commentsCount,
        reactionsCount,
        totalReactions
      };
    }));

    return res.status(200).json({
      success: true,
      data: enrichedPosts,
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

// get-all-posts API, retrieves all posts with optional pagination using lastEvaluatedKey
app.get('/', async (req, res) => {
  const { userId, limit = 20, lastEvaluatedKey } = req.query;

  let params;

  if (userId) {
    // Use query with GSI if userId is specified
    params = {
      TableName: POSTS_TABLE,
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
      TableName: POSTS_TABLE,
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


app.get('/media-url/:postId', async (req, res) => {
  try {
    const { postId } = req.params;

    // 1. Fetch the post metadata
    const { Item: post } = await dynamoDb.get({
      TableName: POSTS_TABLE,
      Key: { postId },
    }).promise();

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const { mediaItems = [], resourceType = 'text' } = post;

    // 2. If text-only post or no mediaItems, return a simple message
    if (!Array.isArray(mediaItems) || mediaItems.length === 0 || resourceType === 'text') {
      return res.status(200).json({
        message: 'This is a text-only post or has no media items.',
        postId,
        resourceType,
      });
    }

    // 3. Generate pre-signed URLs for each media item
    const signedMediaUrls = await Promise.all(
      mediaItems.map(async (item) => {
        const url = await s3.getSignedUrlPromise('getObject', {
          Bucket: ENV_AWS_BUCKET_NAME,
          Key: item.s3Key,
          Expires: 3600, // 1 hour
          ResponseContentDisposition: `inline; filename="${item.fileName}"`,
          ResponseContentType: item.mimeType,
        });

        return {
          fileName: item.fileName,
          mimeType: item.mimeType,
          index: item.index,
          status: item.status || 'unknown',
          mediaUrl: url,
        };
      })
    );

    // 4. Return all signed media URLs
    res.json({
      success: true,
      postId,
      resourceType,
      mediaFiles: signedMediaUrls,
    });

  } catch (error) {
    console.error('Media URL generation error:', error);
    res.status(500).json({
      error: 'Failed to generate media download links',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }



});


const AUDIO_MIME_TYPES = [
  'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/x-m4a',
  'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wave'
];
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
// Post with individual audio data, post and audio are different
app.post('/create-post/audio', upload.none(), async (req, res) => {
  try {
    const {
      userId,
      posttitle,
      content,
      resourceType,
      privacy = 'public',
      mediaTitlename,

      audioMeta,
      coverImageMeta,

      ...data
    } = req.body;

    // Parse audio metadata
    let audio = typeof audioMeta === 'string' ? JSON.parse(audioMeta) : audioMeta;
    let coverImage = coverImageMeta ? (typeof coverImageMeta === 'string' ? JSON.parse(coverImageMeta) : coverImageMeta) : null;

    if (!audio?.fileName || !audio?.mimeType || !AUDIO_MIME_TYPES.includes(audio.mimeType)) {
      return res.status(400).json({ error: 'Invalid or missing audio metadata' });
    }

    if (coverImage && (!coverImage.fileName || !IMAGE_MIME_TYPES.includes(coverImage.mimeType))) {
      return res.status(400).json({ error: 'Invalid cover image metadata' });
    }

    if (!userId || !posttitle || !mediaTitlename) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate user
    const userCheck = await dynamoDb.get({
      TableName: USERS_TABLE,
      Key: { userId }
    }).promise();
    if (!userCheck.Item) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { Filter } = await import('bad-words');
    const filter = new Filter();
    if (filter.isProfane(posttitle) || (content && filter.isProfane(content))) {
      return res.status(400).json({ error: 'Profanity detected' });
    }

    // Generate IDs
    const postId = `post-audio-${uuidv4()}`;
    const audioId = `audio-${uuidv4()}`;
    const createdAt = new Date().toISOString();

    // Sanitize filenames
    const sanitizedAudioName = audio.fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
    const audioS3Key = `${env}/public/audio/${audioId}/${sanitizedAudioName}`;
    const audioUrl = `${audioS3Key}`;

    const audioUploadUrl = s3.getSignedUrl('putObject', {
      Bucket: ENV_AWS_BUCKET_NAME,
      Key: audioS3Key,
      ContentType: audio.mimeType,
      Expires: 300,
    });

    let coverImageUrl = null;
    let coverImageUploadUrl = null;

    if (coverImage) {
      const sanitizedCoverName = coverImage.fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
      const coverS3Key = `${env}/public/audio/${audioId}/cover/${sanitizedCoverName}`;
      coverImageUrl = `${coverS3Key}`;

      coverImageUploadUrl = s3.getSignedUrl('putObject', {
        Bucket: ENV_AWS_BUCKET_NAME,
        Key: coverS3Key,
        ContentType: coverImage.mimeType,
        Expires: 300,
      });
    }

    // Save audio metadata
    await dynamoDb.put({
      TableName: AUDIO_TABLE,
      Item: {
        audioId,
        userId,
        title: mediaTitlename,
        fileName: sanitizedAudioName,
        mimeType: audio.mimeType,
        s3Key: audioS3Key,
        mediaUrl: audioUrl,
        coverImageUrl,
        uploadedAt: createdAt,
        // Additional metadata for audio
        album: data.album || 'unknown',
        artist: data.artist || 'unknown',
        label: data.label || 'unknown',
        duration: data.duration ? Number(data.duration) : null,
        genre: data.genre || 'unknown',
        language: data.language || 'unknown',
        bitrate: data.bitrate ? Number(data.bitrate) : null,
        active: true,
        upload_status: 'pending'
      }
    }).promise();

    // Save post
    const postItem = {
      postId,
      userId,
      createdAt,
      resourceType: 'audio',
      posttitle,
      content: content || null,
      mediaItems: [{
        audioId,
        fileName: sanitizedAudioName,
        mimeType: audio.mimeType,
        s3Key: audioS3Key,
        mediaUrl: audioUrl,
        coverImageUrl,
      }],
      privacy,
      status: 'pending_upload',
      views: 0,
      commentsCount: 0,
      active: true
    };

    await dynamoDb.put({
      TableName: POSTS_TABLE,
      Item: postItem
    }).promise();

    return res.status(200).json({
      success: true,
      message: 'Pre-signed URLs generated',
      postId,
      audioId,
      uploadUrls: {
        audio: { uploadUrl: audioUploadUrl, fileName: sanitizedAudioName },
        ...(coverImageUploadUrl && { coverImage: { uploadUrl: coverImageUploadUrl, fileName: coverImage.fileName } })
      },
      postData: postItem
    });

  } catch (error) {
    console.error('Presigned URL generation error:', error);
    return res.status(500).json({ error: 'Failed to generate upload URLs' });
  }
});

app.patch('/update-audio', async (req, res) => {
  const { audioId, userId, updates } = req.body;

  if (!audioId || !userId || typeof updates !== 'object' || Object.keys(updates).length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid audioId, userId, or updates',
      details: { required: ['audioId', 'userId', 'updates: { title?, artist?, label?, duration?, genre?, album?, label?, language?, bitrate?, active?, upload_status? }'] }
    });
  }

  try {
    // Step 1: Get existing audio record
    const result = await dynamoDb.get({
      TableName: AUDIO_TABLE,
      Key: { audioId }
    }).promise();

    const audioItem = result.Item;

    if (!audioItem) {
      return res.status(404).json({ success: false, error: 'Audio not found' });
    }

    if (audioItem.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied. You do not own this audio.' });
    }

    // Step 2: Filter valid updatable fields
    const allowedFields = ['title', 'artist','label', 'duration', 'genre', 'album', 'language', 'bitrate', 'active','upload_status'];
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

    if (expressionParts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update.'
      });
    }

    const UpdateExpression = 'SET ' + expressionParts.join(', ');

    // Step 3: Perform the update
    await dynamoDb.update({
      TableName: AUDIO_TABLE,
      Key: { audioId },
      UpdateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues
    }).promise();

    return res.status(200).json({
      success: true,
      message: 'Audio metadata updated successfully',
      audioId,
      updatedFields: Object.keys(expressionAttributeValues).map(k => k.replace(':', ''))
    });

  } catch (error) {
    console.error('Error updating audio metadata:', error);
    return res.status(500).json({ success: false, error: 'Failed to update audio metadata' });
  }
});

// delete individual audio file
app.delete('/audio', async (req, res) => {
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


const VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/webm',
];

app.post('/create-post/video', upload.none(), async (req, res) => {
  try {
    const {
      userId,
      posttitle,
      content,
      resourceType,
      privacy = 'public',
      mediaTitlename,
      videoMeta,
      coverImageMeta,

      ...data
    } = req.body;

    // Parse audio metadata
    let video = typeof videoMeta === 'string' ? JSON.parse(videoMeta) : videoMeta;
    let coverImage = coverImageMeta ? (typeof coverImageMeta === 'string' ? JSON.parse(coverImageMeta) : coverImageMeta) : null;

    if (!video?.fileName || !video?.mimeType || !VIDEO_MIME_TYPES.includes(video.mimeType)) {
      return res.status(400).json({ error: 'Invalid or missing video metadata' });
    }

    if (coverImage && (!coverImage.fileName || !IMAGE_MIME_TYPES.includes(coverImage.mimeType))) {
      return res.status(400).json({ error: 'Invalid cover image metadata' });
    }

    if (!userId || !posttitle || !mediaTitlename) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate user
    const userCheck = await dynamoDb.get({
      TableName: USERS_TABLE,
      Key: { userId }
    }).promise();
    if (!userCheck.Item) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { Filter } = await import('bad-words');
    const filter = new Filter();
    if (filter.isProfane(posttitle) || (content && filter.isProfane(content))) {
      return res.status(400).json({ error: 'Profanity detected' });
    }

    // Generate IDs
    const postId = `post-video-${uuidv4()}`;
    const videoId = `video-${uuidv4()}`;
    const createdAt = new Date().toISOString();

    // Sanitize filenames
    const sanitizedVideoName = video.fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
    const videoS3Key = `${env}/public/video/${videoId}/${sanitizedVideoName}`;
    const videoUrl = `${videoS3Key}`;

    const videoUploadUrl = s3.getSignedUrl('putObject', {
      Bucket: ENV_AWS_BUCKET_NAME,
      Key: videoS3Key,
      ContentType: video.mimeType,
      Expires: 300,
    });

    let coverImageUrl = null;
    let coverImageUploadUrl = null;

    if (coverImage) {
      const sanitizedCoverName = coverImage.fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
      const coverS3Key = `${env}/public/video/${videoId}/cover/${sanitizedCoverName}`;
      coverImageUrl = `${coverS3Key}`;

      coverImageUploadUrl = s3.getSignedUrl('putObject', {
        Bucket: ENV_AWS_BUCKET_NAME,
        Key: coverS3Key,
        ContentType: coverImage.mimeType,
        Expires: 300,
      });
    }

    // Save video metadata
    await dynamoDb.put({
      TableName: VIDEO_TABLE,
      Item: {
        videoId,
        userId,
        title: mediaTitlename,
        fileName: sanitizedVideoName,
        mimeType: video.mimeType,
        s3Key: videoS3Key,
        mediaUrl: videoUrl,
        coverImageUrl,
        uploadedAt: createdAt,
        // Additional metadata for video
        duration: data.duration || null,
        resolution: data.resolution || null,
        format: data.format || null,
        active: true,
        upload_status: 'pending'
      }
    }).promise();

    // Save post
    const postItem = {
      postId,
      userId,
      createdAt,
      resourceType: 'video',
      posttitle,
      content: content || null,
      mediaItems: [{
        videoId,
        fileName: sanitizedVideoName,
        mimeType: video.mimeType,
        s3Key: videoS3Key,
        mediaUrl: videoUrl,
        coverImageUrl,
      }],
      privacy,
      status: 'pending_upload',
      views: 0,
      commentsCount: 0,
      active: true
    };

    await dynamoDb.put({
      TableName: POSTS_TABLE,
      Item: postItem
    }).promise();

    return res.status(200).json({
      success: true,
      message: 'Pre-signed URLs generated',
      postId,
      videoId,
      uploadUrls: {
        video: { uploadUrl: videoUploadUrl, fileName: sanitizedVideoName },
        ...(coverImageUploadUrl && { coverImage: { uploadUrl: coverImageUploadUrl, fileName: coverImage.fileName } })
      },
      postData: postItem
    });

  } catch (error) {
    console.error('Presigned URL generation error:', error);
    return res.status(500).json({ error: 'Failed to generate upload URLs' });
  }
});

app.patch('/update-video', async (req, res) => {
  const { videoId, userId, updates } = req.body;

  if (!videoId || !userId || typeof updates !== 'object' || Object.keys(updates).length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid videoId, userId, or updates',
      details: { required: ['videoId', 'userId', 'updates: { duration?, resolution?, format?, active?,upload_status? }'] }
    });
  }

  try {
    // Step 1: Get existing audio record
    const result = await dynamoDb.get({
      TableName: VIDEO_TABLE,
      Key: { videoId }
    }).promise();

    const videoItem = result.Item;

    if (!videoItem) {
      return res.status(404).json({ success: false, error: 'Video not found' });
    }

    if (videoItem.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied. You do not own this Video.' });
    }

    // Step 2: Filter valid updatable fields
    const allowedFields = ['duration', 'resolution', 'format', 'active', 'upload_status'];
    const expressionParts = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    for (const key of allowedFields) {
      if (key in updates) {
        expressionParts.push(`#${key} = :${key}`);
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = updates[key];
      }
    }

    if (expressionParts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update.'
      });
    }

    const UpdateExpression = 'SET ' + expressionParts.join(', ');

    // Step 3: Perform the update
    await dynamoDb.update({
      TableName: VIDEO_TABLE,
      Key: { videoId },
      UpdateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues
    }).promise();

    return res.status(200).json({
      success: true,
      message: 'Video metadata updated successfully',
      videoId,
      updatedFields: Object.keys(expressionAttributeValues).map(k => k.replace(':', ''))
    });

  } catch (error) {
    console.error('Error updating video metadata:', error);
    return res.status(500).json({ success: false, error: 'Failed to update video metadata' });
  }
});

app.delete('/video', async (req, res) => {
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




const IMAGE_MIME_TYPES_ALL = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/bmp',
  'image/svg+xml',
  'image/gif'
];



app.post('/create-post/image', upload.none(), async (req, res) => {
  try {
    const {
      userId,
      posttitle,
      content,
      resourceType,
      privacy = 'public',
    } = req.body;

    let files = req.body.files;

    if (typeof files === 'string') {
      try {
        files = JSON.parse(files);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid files JSON format' });
      }
    }

    if (!userId || !posttitle || !resourceType || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: { required: ['userId', 'posttitle', 'resourceType', 'files (array)'] },
      });
    }

    //  Validate image MIME types
    for (const file of files) {
      if (!IMAGE_MIME_TYPES_ALL.includes(file.mimeType)) {
        return res.status(400).json({ error: `Unsupported image MIME type: ${file.mimeType}` });
      }
    }

    //  Normalize indexes
    const seen = new Set();
    let nextIndex = 0;

    files = files.map((file) => {
      let idx = Number(file.index);
      if (isNaN(idx) || seen.has(idx)) {
        while (seen.has(nextIndex)) nextIndex++;
        idx = nextIndex++;
      }
      seen.add(idx);
      return { ...file, index: idx };
    });

    //  Validate user
    const userCheck = await dynamoDb.get({
      TableName: USERS_TABLE,
      Key: { userId },
    }).promise();
    if (!userCheck.Item) {
      return res.status(404).json({ success: false, error: 'Invalid userId. User not found.' });
    }

    //  Profanity check
    const { Filter } = await import('bad-words');
    const filter = new Filter();
    if (filter.isProfane(posttitle)) {
      return res.status(400).json({ success: false, error: 'Title contains inappropriate language.' });
    }
    if (content && filter.isProfane(content)) {
      return res.status(400).json({ success: false, error: 'Content contains inappropriate language.' });
    }

    const postId = `post-image-${uuidv4()}`;
    const createdAt = new Date().toISOString();

    const imageMetaList = [];

    for (const file of files) {
      console.log('Processing file:', file);
      const imageId = `image-${uuidv4()}`;
      const sanitizedFileName = file.fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
      const s3Key = `${env}/public/image/${imageId}/${sanitizedFileName}`;
      const mediaUrl = `${s3Key}`;

      const uploadUrl = s3.getSignedUrl('putObject', {
        Bucket: ENV_AWS_BUCKET_NAME,
        Key: s3Key,
        ContentType: file.mimeType,
        Expires: 300
      });

      //  Save image metadata in image table
      await dynamoDb.put({
        TableName: IMAGE_TABLE, // Ensure this env var is set
        Item: {
          imageId,
          userId,
          fileName: sanitizedFileName,
          mimeType: file.mimeType,
          s3Key,
          mediaUrl,
          uploadedAt: createdAt,
          active: true,
          upload_status: 'pending'
        }
      }).promise();

      imageMetaList.push({
        imageId,
        fileName: sanitizedFileName,
        mimeType: file.mimeType,
        s3Key,
        mediaUrl,
        uploadUrl,
        index: file.index ?? null,
      });
    }

    //  Save POST
    const postItem = {
      postId,
      userId,
      createdAt,
      resourceType: 'image',
      posttitle,
      content: content || null,
      mediaItems: imageMetaList.map(({ imageId, fileName, mimeType, s3Key, mediaUrl, index, status }) => ({
        imageId,
        fileName,
        mimeType,
        s3Key,
        mediaUrl,
        index,
        status
      })),
      privacy,
      status: 'pending_upload',
      views: 0,
      commentsCount: 0,
      active: true
    };

    await dynamoDb.put({
      TableName: POSTS_TABLE,
      Item: postItem,
      ConditionExpression: 'attribute_not_exists(postId)',
    }).promise();

    return res.status(200).json({
      success: true,
      message: 'Pre-signed image upload URLs generated',
      postId,
      mediaUploadUrls: imageMetaList.map(({ uploadUrl, fileName }) => ({ uploadUrl, fileName })),
      postData: postItem,
    });

  } catch (error) {
    console.error('Image upload URL generation failed:', error);
    return res.status(500).json({ success: false, error: 'Image upload URL generation failed' });
  }
});



app.patch('/update-image', async (req, res) => {
  const { imageId, userId, updates } = req.body;

  if (!imageId || !userId || typeof updates !== 'object' || Object.keys(updates).length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid imageId, userId, or updates',
      details: { required: ['imageId', 'userId', 'updates: { active?,upload_status? }'] }
    });
  }

  try {
    // Step 1: Fetch image
    const result = await dynamoDb.get({
      TableName: IMAGE_TABLE,
      Key: { imageId }
    }).promise();

    const imageItem = result.Item;

    if (!imageItem) {
      return res.status(404).json({ success: false, error: 'Image not found' });
    }

    if (imageItem.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied. You do not own this Image.' });
    }

    // Step 2: Prepare updates
    const allowedFields = ['active', 'upload_status'];
    const expressionParts = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    for (const key of allowedFields) {
      if (key in updates) {
        expressionParts.push(`#${key} = :${key}`);
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = updates[key];
      }
    }

    if (expressionParts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update. Allowed: active.'
      });
    }

    const UpdateExpression = 'SET ' + expressionParts.join(', ');

    // Step 3: Update metadata
    await dynamoDb.update({
      TableName: IMAGE_TABLE,
      Key: { imageId },
      UpdateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues
    }).promise();

    return res.status(200).json({
      success: true,
      message: 'Image metadata updated successfully',
      imageId,
      updatedFields: Object.keys(updates)
    });

  } catch (error) {
    console.error('Error updating Image metadata:', error);
    return res.status(500).json({ success: false, error: 'Failed to update Image metadata' });
  }
});


app.delete('/image', async (req, res) => {
  try {
    const { imageId, userId } = req.body;

    if (!imageId || !userId) {
      return res.status(400).json({ error: 'Missing imageId or userId' });
    }

    // Fetch audio metadata
    const { Item: imageItem } = await dynamoDb.get({
      TableName: IMAGE_TABLE,
      Key: { imageId }
    }).promise();

    if (!imageItem || imageItem.userId !== userId) {
      return res.status(404).json({ error: 'Image not found or unauthorized' });
    }

    // Prepare S3 keys to delete
    const objectsToDelete = [
      { Key: imageItem.s3Key }
    ];

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
      TableName: IMAGE_TABLE,
      Key: { imageId }
    }).promise();



    return res.status(200).json({
      success: true,
      message: 'Image deleted successfully'
    });

  } catch (error) {
    console.error('Image deletion error:', error);
    return res.status(500).json({ error: 'Failed to delete Image or files' });
  }
});



// playlist post creation API
app.post('/create-post/playlist', async (req, res) => {
  try {
    const {
      userId,
      posttitle,
      content,
      resourceType,
      privacy = 'public',
      playlistId
    } = req.body;

    if (!userId || !posttitle || !playlistId) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: { required: ['userId', 'posttitle', 'playlistId'] },
      });
    }

    //  Validate user
    const userCheck = await dynamoDb.get({
      TableName: USERS_TABLE,
      Key: { userId },
    }).promise();
    if (!userCheck.Item) {
      return res.status(404).json({ error: 'Invalid userId. User not found.' });
    }

    //  Fetch playlist metadata
    const playlistResult = await dynamoDb.get({
      TableName: PLAYLISTS_TABLE,
      Key: { playlistId },
    }).promise();
    const playlist = playlistResult.Item;

    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    //  Profanity check
    const { Filter } = await import('bad-words');
    const filter = new Filter();
    if (filter.isProfane(posttitle)) {
      return res.status(400).json({ error: 'Title contains inappropriate language.' });
    }
    if (content && filter.isProfane(content)) {
      return res.status(400).json({ error: 'Content contains inappropriate language.' });
    }

    //  Create post
    const postId = `post-playlist-${uuidv4()}`;
    const createdAt = new Date().toISOString();
    console.log('playlist item:', playlist);

    const postItem = {
      postId,
      userId,
      createdAt,
      resourceType: 'playlist',
      posttitle,
      content: content || null,
      mediaItems: [{
        playlistId,
        title: playlist.title,
        description: playlist.description || null,
        coverImageUrl: playlist.coverImage || null,
        likesCount: playlist.likesCount || 0,
        tracks: Array.isArray(playlist.tracks) ? playlist.tracks.length : 0,
      }],
      privacy,
      status: 'published',
      views: 0,
      commentsCount: 0,
      active: true
    };


    console.log('Post item:', postItem);
    await dynamoDb.put({
      TableName: POSTS_TABLE,
      Item: postItem,
      ConditionExpression: 'attribute_not_exists(postId)',
    }).promise();

    return res.status(200).json({
      success: true,
      message: 'Playlist post created successfully',
      postId,
      postData: postItem
    });

  } catch (error) {
    console.error('Playlist post creation failed:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});


module.exports = app;

