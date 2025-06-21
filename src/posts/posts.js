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
//         TableName: process.env.DYNAMODB_TABLE_USERS,
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
//         TableName: process.env.DYNAMODB_TABLE_POSTS,
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
    const { userId, content, resourceType = 'text', privacy = 'public' } = req.body;

    if (!userId || !content) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: { required: ['userId', 'content'] },
      });
    }

    const userCheck = await dynamoDb.get({
      TableName: process.env.DYNAMODB_TABLE_USERS,
      Key: { userId },
    }).promise();

    if (!userCheck.Item) {
      return res.status(404).json({ success: false, error: 'Invalid userId. User not found.' });
    }

    const { Filter } = await import('bad-words');
    const filter = new Filter();
    if (filter.isProfane(content)) {
      return res.status(400).json({ success: false, error: 'Content contains inappropriate language.' });
    }

    const postId = 'post-text-' + uuidv4();
    const createdAt = new Date().toISOString();

    const post = {
      postId,
      userId,
      createdAt,
      resourceType,
      content,
      privacy,
      status: 'active',
      views: 0,
      likesCount: 0,
      commentsCount: 0,
    };

    await dynamoDb.put({
      TableName: process.env.DYNAMODB_TABLE_POSTS,
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
    } = req.body;

    const file = req.file;
    console.log('Received file:', file);

    const MAX_FILE_SIZE = 30 * 1024 * 1024; // 10MB
    if (file.size > MAX_FILE_SIZE) {
      return res.status(400).json({
        error: 'File size exceeds limit',
        maxAllowedSize: `${MAX_FILE_SIZE / (1024 * 1024)} MB`,
        receivedSize: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
      });
    }
    if (!userId || !file || !fileName || !mimeType) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: { required: ['userId', 'file', 'fileName', 'mimeType'] },
      });
    }

    const userCheck = await dynamoDb.get({
      TableName: process.env.DYNAMODB_TABLE_USERS,
      Key: { userId },
    }).promise();

    if (!userCheck.Item) {
      return res.status(404).json({ success: false, error: 'Invalid userId. User not found.' });
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
      mimeType,
      s3Key,
      mediaUrl: uploadResult.Location,
      privacy,
      status: 'active',
      views: 0,
      likesCount: 0,
      commentsCount: 0,
    };

    await dynamoDb.put({
      TableName: process.env.DYNAMODB_TABLE_POSTS,
      Item: post,
      ConditionExpression: 'attribute_not_exists(postId)',
    }).promise();

    return res.status(201).json({ success: true, message: 'Media post created', data: post });

  } catch (error) {
    console.error('Media post creation failed:', error);
    return res.status(500).json({ success: false, error: 'Media post creation failed' });
  }
});

app.post('/create-post/large-media', upload.none(), async (req, res) => {

  try {
    const {
      userId,
      fileName,
      mimeType,
      resourceType = 'media',
      privacy = 'public',
      content
    } = req.body;
    console.log('Received body:', req.body);
    if (!userId || !fileName || !mimeType) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: { required: ['userId', 'fileName', 'mimeType'] },
      });
    }

    const userCheck = await dynamoDb.get({
      TableName: process.env.DYNAMODB_TABLE_USERS,
      Key: { userId },
    }).promise();

    if (!userCheck.Item) {
      return res.status(404).json({ success: false, error: 'Invalid userId. User not found.' });
    }

    const postId = `post-${resourceType}-` + uuidv4();
    const createdAt = new Date().toISOString();

    const sanitizedFileName = fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
    const s3Key = `${process.env.APP_ENV}/${userId}/${resourceType}/${sanitizedFileName}`;

    const uploadUrl = s3.getSignedUrl('putObject', {
      Bucket: process.env.AWS_BUCKET_NAME,
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
      mimeType,
      s3Key,
      mediaUrl: `https://${process.env.AWS_BUCKET_NAME}.s3.amazonaws.com/${s3Key}`,
      privacy,
      status: 'pending_upload',
      views: 0,
      likesCount: 0,
      commentsCount: 0,
    };

    await dynamoDb.put({
      TableName: process.env.DYNAMODB_TABLE_POSTS,
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

// update-post/text API, updates an existing text post
app.patch('/update-post/text/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    const { userId, content, privacy } = req.body;

    if (!postId || !userId || !content) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const post = await dynamoDb.get({
      TableName: process.env.DYNAMODB_TABLE_POSTS,
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

    if (filter.isProfane(content)) {
      return res.status(400).json({ success: false, error: 'Content contains inappropriate language.' });

    }

    const updatedAt = new Date().toISOString();

    const updatedPost = {
      ...post.Item,
      content,
      privacy: privacy || post.Item.privacy,
      updatedAt,
      resourceType,
    };

    await dynamoDb.put({
      TableName: process.env.DYNAMODB_TABLE_POSTS,
      Item: updatedPost,
    }).promise();

    res.json({ success: true, message: 'Text post updated', data: updatedPost });

  } catch (error) {
    console.error('Update text post error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});


app.patch('/update-post/media/:postId', upload.single('file'), async (req, res) => {
  try {
    const { postId } = req.params;
    const { userId, fileName, mimeType, resourceType, privacy, content } = req.body;
    const file = req.file;
    if (!postId || !userId || !fileName || !mimeType || !resourceType || !file) {
      return res.status(400).json({ error: 'Missing required fields for media update' });
    }

    const post = await dynamoDb.get({
      TableName: process.env.DYNAMODB_TABLE_POSTS,
      Key: { postId },
    }).promise();

    if (!post.Item) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.Item.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized user' });
    }

    const sanitizedFileName = fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
    const s3Key = `${process.env.APP_ENV}/${userId}/${resourceType}/${sanitizedFileName}`;

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
      ContentType: mimeType,
    });


    const updatedAt = new Date().toISOString();

    const updatedPost = {
      ...post.Item,
      resourceType,
      fileName: sanitizedFileName,
      mimeType,
      s3Key,
      content,
      mediaUrl: uploadResult.Location,
      privacy: privacy || post.Item.privacy,
      updatedAt,
    };

    await dynamoDb.put({
      TableName: process.env.DYNAMODB_TABLE_POSTS,
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
    const { userId, fileName, mimeType, resourceType, privacy, content } = req.body;

    if (!postId || !userId || !fileName || !mimeType || !resourceType) {
      return res.status(400).json({ error: 'Missing required fields for media update' });
    }

    const post = await dynamoDb.get({
      TableName: process.env.DYNAMODB_TABLE_POSTS,
      Key: { postId },
    }).promise();

    if (!post.Item) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.Item.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized user' });
    }

    const sanitizedFileName = fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
    const s3Key = `${process.env.APP_ENV}/${userId}/${resourceType}/${sanitizedFileName}`;

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
      ContentType: mimeType,
      Expires: 60 * 10, // longer time for large files
    });

    const updatedAt = new Date().toISOString();

    const updatedPost = {
      ...post.Item,
      resourceType,
      fileName: sanitizedFileName,
      mimeType,
      s3Key,
      content,
      mediaUrl: presignedUrl,
      privacy: privacy || post.Item.privacy,
      updatedAt,
    };

    await dynamoDb.put({
      TableName: process.env.DYNAMODB_TABLE_POSTS,
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
      TableName: process.env.DYNAMODB_TABLE_POSTS,
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
      TableName: process.env.DYNAMODB_TABLE_COMMENTS,
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
            [process.env.DYNAMODB_TABLE_COMMENTS]: batch
          }
        }).promise();
      }
    }

    // 4. Delete all reactions on this post
    const reactionResult = await dynamoDb.scan({
      TableName: process.env.DYNAMODB_TABLE_REACTIONS,
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
            [process.env.DYNAMODB_TABLE_REACTIONS]: batch
          }
        }).promise();
      }
    }

    // 5. Delete the post itself
    await dynamoDb.delete({
      TableName: process.env.DYNAMODB_TABLE_POSTS,
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
      TableName: process.env.DYNAMODB_TABLE_POSTS,
      Key: { postId }
    }).promise();

    if (!result.Item) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    // 2. Count comments using PostIdIndex
    const commentResult = await dynamoDb.query({
      TableName: process.env.DYNAMODB_TABLE_COMMENTS,
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
      TableName: process.env.DYNAMODB_TABLE_REACTIONS,
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

// get-all-posts API, retrieves all posts with optional pagination using lastEvaluatedKey
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


app.get('/download-multipart/:postId', async (req, res) => {
  try {
    const { postId } = req.params;

    // 1. Fetch the post from DynamoDB
    const result = await dynamoDb.get({
      TableName: process.env.DYNAMODB_TABLE_POSTS,
      Key: { postId }
    }).promise();

    const post = result.Item;
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const resourceType = post.resourceType || 'text'; // default fallback

    // 2. If text-only, no file to download
    if (resourceType === 'text' || !post.s3Key) {
      return res.status(200).json({
        message: 'This is a text-only post. No media available to download.',
        postId,
        resourceType
      });
    }

    // 3. Get file size from S3
    const { ContentLength: fileSize } = await s3.headObject({
      Bucket: BUCKET,
      Key: post.s3Key
    }).promise();

    // 4. Generate pre-signed URLs in 10MB chunks
    const PART_SIZE = 10 * 1024 * 1024;
    const partCount = Math.ceil(fileSize / PART_SIZE);
    const downloadId = `d-` + uuidv4();

    const parts = [];
    for (let i = 0; i < partCount; i++) {
      const startByte = i * PART_SIZE;
      const endByte = Math.min(startByte + PART_SIZE - 1, fileSize - 1);

      const url = await s3.getSignedUrlPromise('getObject', {
        Bucket: BUCKET,
        Key: post.s3Key,
        ResponseContentDisposition: `attachment; filename="${post.fileName}"`,
        ResponseContentType: post.mimeType,
        Expires: 3600,
        Range: `bytes=${startByte}-${endByte}`
      });

      parts.push({
        partNumber: i + 1,
        startByte,
        endByte,
        url
      });
    }

    // 5. Return download metadata
    res.json({
      downloadId,
      postId,
      resourceType,
      fileName: post.fileName,
      mimeType: post.mimeType,
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

module.exports = app;

