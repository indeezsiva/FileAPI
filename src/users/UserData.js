// user.js
require('dotenv').config();
const express = require('express');
const AWS = require('aws-sdk');
require('dotenv').config();
const app = express();
const cors = require("cors");
const env = process.env.APP_ENV || 'dev'; // 'dev', 'prod', etc.
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const CryptoJS = require("crypto-js");
const fileService = require('./../../aws.service'); // Assuming your multipart upload function is in fileService.js


// aws config for aws access
AWS.config.update({
  region: process.env.REGION,
  accessKeyId: process.env.ACCESS_KEY_ID,
  secretAccessKey: process.env.SECRET_ACCESS_KEY,
});
const s3 = new AWS.S3();

const cognitoIdentityServiceProvider = new AWS.CognitoIdentityServiceProvider();

const APP_ENV = process.env.APP_ENV;
const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME;
const DYNAMODB_TABLE_USERS_FOLLOWS = process.env.DYNAMODB_TABLE_USERS_FOLLOWS;

const ENV_AWS_BUCKET_NAME = `${APP_ENV}-${AWS_BUCKET_NAME}`;
const USER_FOLLOW_TABLE = `${APP_ENV}-${DYNAMODB_TABLE_USERS_FOLLOWS}`;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; 
function encryptData(data) {
  const keyHex = ENCRYPTION_KEY;
  const key = CryptoJS.enc.Hex.parse(keyHex);
  const iv = CryptoJS.enc.Hex.parse(keyHex.substring(0, 32)); // 16 bytes

  const encrypted = CryptoJS.AES.encrypt(JSON.stringify(data), key, {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  return encrypted.ciphertext.toString(CryptoJS.enc.Base64); // return raw base64
}

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
// Example route
app.get('/user/ping', (req, res) => {
  res.send('user route is live !!');
});
const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml'
];

app.post('/create', async (req, res) => {
  const {
    userId,
    firstName,
    lastName,
    email,
    phone,
    zipCode,
    userType,
    acceptPrivacyPolicy,
    acceptTerms,
    avatarUrl, // optional direct input
    bio,
    profileImage, // name of the file (to generate key)
    mimeType // to validate and generate signed URL
  } = req.body;

  // Validate allowed fields
  const allowedFields = [
    'userId',
    'firstName',
    'lastName',
    'email',
    'phone',
    'zipCode',
    'userType',
    'acceptPrivacyPolicy',
    'acceptTerms',
    'avatarUrl',
    'bio',
    'profileImage',
    'mimeType'
  ];

  const unknownFields = Object.keys(req.body).filter(
    key => !allowedFields.includes(key)
  );
  if (unknownFields.length > 0) {
    return res.status(400).json({
      error: 'Unexpected fields provided',
      unknownFields
    });
  }

  // Basic validations
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'Valid userId is required' });
  }
  if (!firstName || typeof firstName !== 'string') {
    return res.status(400).json({ error: 'Valid firstName is required' });
  }
  if (!lastName || typeof lastName !== 'string') {
    return res.status(400).json({ error: 'Valid lastName is required' });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  if (phone && typeof phone !== 'string') {
    return res.status(400).json({ error: 'Phone must be a string' });
  }
  if (zipCode && (typeof zipCode !== 'string' || !/^\d{5,10}$/.test(zipCode))) {
    return res.status(400).json({ error: 'Valid zip code (5 to 10 digits) is required' });
  }
  if (acceptPrivacyPolicy !== true || acceptTerms !== true) {
    return res.status(400).json({ error: 'Privacy policy and terms must be accepted' });
  }
  if (avatarUrl && typeof avatarUrl !== 'string') {
    return res.status(400).json({ error: 'avatarUrl must be a string' });
  }
  if (bio && typeof bio !== 'string') {
    return res.status(400).json({ error: 'bio must be a string' });
  }

  // Check uniqueness of email or phone
  try {
    const scanParams = {
      TableName: USER_TABLE,
      FilterExpression: 'email = :email OR phone = :phone',
      ExpressionAttributeValues: {
        ':email': email,
        ':phone': phone
      },
      ProjectionExpression: 'userId'
    };

    const existingUsers = await dynamoDb.scan(scanParams).promise();
    if (existingUsers.Count > 0) {
      return res.status(409).json({ error: 'Email or phone already exists' });
    }
  } catch (err) {
    console.error('Failed uniqueness check:', err);
    return res.status(500).json({ error: 'Failed to validate uniqueness' });
  }

  // Handle profile image pre-signed URL
  let uploadUrl = null;
  let finalAvatarUrl = avatarUrl || null;

  if (profileImage || mimeType) {
    if (!profileImage || !mimeType) {
      return res.status(400).json({
        error: 'Both profileImage and mimeType are required for uploading profile image'
      });
    }

    if (!IMAGE_MIME_TYPES.includes(mimeType)) {
      return res.status(400).json({ error: `Unsupported avatar image MIME type: ${mimeType}` });
    }

    const fileName = profileImage.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
    const s3Key = `${env}/public/users/${userId}/profile/${fileName}`;

    uploadUrl = s3.getSignedUrl('putObject', {
      Bucket: ENV_AWS_BUCKET_NAME,
      Key: s3Key,
      ContentType: mimeType,
      Expires: 300
    });

    finalAvatarUrl = s3Key;
  }

  // Save to DynamoDB
  const params = {
    TableName: USER_TABLE,
    Item: {
      userId,
      firstName,
      lastName,
      email,
      phone: phone || null,
      zipCode: zipCode || null,
      userType,
      acceptPrivacyPolicy,
      acceptTerms,
      avatarUrl: finalAvatarUrl,
      bio: bio || null,
      createdAt: new Date().toISOString()
    },
    ConditionExpression: 'attribute_not_exists(userId)'
  };

  try {
    await dynamoDb.put(params).promise();
    return res.status(201).json({
      message: 'User created',
      userId,
      ...(uploadUrl && { profileUploadUrl: uploadUrl })
    });
  } catch (error) {
    if (error.code === 'ConditionalCheckFailedException') {
      return res.status(409).json({ error: 'User already exists' });
    }
    console.error('Create user failed:', error);
    return res.status(500).json({ error: 'Could not create user' });
  }
});
app.get('/', async (req, res) => {
  try {
    const data = await dynamoDb.scan({
      TableName: USER_TABLE
    }).promise();

    const usersWithSignedAvatars = (data.Items || []).map(user => {
      const signedUser = { ...user };
      if (user.avatarUrl && !user.avatarUrl.startsWith('http')) {
        signedUser.avatarUrl = fileService.getSignedMediaUrl(user.avatarUrl);
      }
      return signedUser;
    });
    const encrypted = encryptData({ users:usersWithSignedAvatars });

    res.json({ users: encrypted });
  } catch (err) {
    console.error('Error scanning users:', err);
    res.status(500).send('Could not fetch users');
  }
});
app.get('/search', async (req, res) => {
  const {
    keyword = '',
    limit = 10,
    lastKey,
    pageOffset = 0
  } = req.query;

  try {
    const lowerKeyword = keyword.toLowerCase().trim();
    const filterApplied = !!lowerKeyword;

    const scanParams = {
      TableName: USER_TABLE,
      Limit: Number(limit)
    };

    if (lastKey) {
      scanParams.ExclusiveStartKey = JSON.parse(Buffer.from(lastKey, 'base64').toString());
    }

    if (filterApplied) {
      scanParams.FilterExpression = 'contains(#firstName, :kw) OR contains(#lastName, :kw) OR contains(#email, :kw)';
      scanParams.ExpressionAttributeNames = {
        '#firstName': 'firstName',
        '#lastName': 'lastName',
        '#email': 'email',
      };
      scanParams.ExpressionAttributeValues = {
        ':kw': lowerKeyword
      };
    }

    // Count total matches (optional but adds metadata)
    const countParams = {
      TableName: USER_TABLE,
      Select: 'COUNT'
    };

    if (filterApplied) {
      countParams.FilterExpression = scanParams.FilterExpression;
      countParams.ExpressionAttributeNames = scanParams.ExpressionAttributeNames;
      countParams.ExpressionAttributeValues = scanParams.ExpressionAttributeValues;
    }

    const countResult = await dynamoDb.scan(countParams).promise();
    const totalCount = countResult.Count || 0;
    const totalPages = Math.ceil(totalCount / limit);
    const currentPage = Math.floor(pageOffset / limit) + 1;

    const result = await dynamoDb.scan(scanParams).promise();

    // Add pre-signed avatar URLs
    const presignedUserData = (result.Items || []).map(user => {
      const signedUser = { ...user };
      if (user.avatarUrl && !user.avatarUrl.startsWith('http')) {
        signedUser.avatarUrl = fileService.getSignedMediaUrl(user.avatarUrl);
      }
      return signedUser;
    });
    return res.json({
      success: true,
      message: 'Users fetched successfully',
      data:presignedUserData,
      pagination: {
        totalCount,
        totalPages,
        currentPage,
        pageSize: Number(limit),
        hasMore: !!result.LastEvaluatedKey,
        lastKey: result.LastEvaluatedKey
          ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
          : null
      }
    });

  } catch (err) {
    console.error('User search failed:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to search users',
      details: err.message
    });
  }
});



app.get('/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    // Use GetCommand (or get method) to retrieve user by primary key
    const result = await dynamoDb.get({
      TableName: USER_TABLE,
      Key: { userId }
    }).promise();

    const user = result.Item;

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Generate pre-signed avatar URL if avatarUrl exists and is an S3 key
    if (user.avatarUrl && !user.avatarUrl.startsWith('http')) {
      user.avatarUrl = fileService.getSignedMediaUrl(user.avatarUrl);
    }
    const encrypted = encryptData({ users:user });

    return res.json({
      success: true,
      encrypted
    });

  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ success: false, error: 'Could not fetch user' });
  }
});


app.patch("/update/:userId", async (req, res) => {
  const { userId } = req.params;
  const updateData = req.body;

  const allowedFields = [
    'firstName',
    'lastName',
    'email',
    'phone',
    'zipCode',
    'userType',
    'acceptPrivacyPolicy',
    'acceptTerms',
    'avatarUrl',
    'profileImage',
    'mimeType',
    'bio'
  ];

  const unknownFields = Object.keys(updateData).filter(key => !allowedFields.includes(key));
  if (unknownFields.length > 0) {
    return res.status(400).json({
      error: 'Unexpected fields provided',
      unknownFields
    });
  }

  if (!updateData || Object.keys(updateData).length === 0) {
    return res.status(400).json({ message: "No update fields provided" });
  }

  // 1. Email/Phone Uniqueness Check
  try {
    if (updateData.email) {
      const emailCheck = await dynamoDb.query({
        TableName: USER_TABLE,
        IndexName: "email-index",
        KeyConditionExpression: "#email = :email",
        ExpressionAttributeNames: { "#email": "email" },
        ExpressionAttributeValues: { ":email": updateData.email }
      }).promise();

      const emailExists = emailCheck.Items.find(user => user.userId !== userId);
      if (emailExists) {
        return res.status(409).json({ error: "Email already exists" });
      }
    }

    if (updateData.phone) {
      const phoneCheck = await dynamoDb.query({
        TableName: USER_TABLE,
        IndexName: "phone-index",
        KeyConditionExpression: "#phone = :phone",
        ExpressionAttributeNames: { "#phone": "phone" },
        ExpressionAttributeValues: { ":phone": updateData.phone }
      }).promise();

      const phoneExists = phoneCheck.Items.find(user => user.userId !== userId);
      if (phoneExists) {
        return res.status(409).json({ error: "Phone number already exists" });
      }
    }
  } catch (checkErr) {
    console.error("Uniqueness check failed:", checkErr);
    return res.status(500).json({ error: "Failed to validate email or phone uniqueness" });
  }

  // 2. Cognito update (optional)
  try {
    if (updateData.email || updateData.phone || updateData.firstName || updateData.lastName) {
      const attributes = [];

      if (updateData.email) attributes.push({ Name: 'email', Value: updateData.email });
      if (updateData.phone) attributes.push({ Name: 'phone_number', Value: updateData.phone });
      if (updateData.firstName) attributes.push({ Name: 'given_name', Value: updateData.firstName });
      if (updateData.lastName) attributes.push({ Name: 'family_name', Value: updateData.lastName });

      await cognitoIdentityServiceProvider.adminUpdateUserAttributes({
        UserPoolId: process.env.COGNITO_USER_POOL_ID,
        Username: userId,
        UserAttributes: attributes
      }).promise();
    }
  } catch (cognitoErr) {
    console.error("Cognito update error:", cognitoErr);
    return res.status(500).json({ error: "Failed to update Cognito user", details: cognitoErr.message });
  }

  // 3. Avatar upload (validated from client)
  let uploadUrl = null;
if (updateData.profileImage || updateData.mimeType) {
  if (!updateData.profileImage || !updateData.mimeType) {
    return res.status(400).json({
      error: 'Both profileImage and mimeType are required to upload profile image'
    });
  }

  const mimeType = updateData.mimeType;

  if (!IMAGE_MIME_TYPES.includes(mimeType)) {
    return res.status(400).json({ error: `Unsupported avatar image MIME type: ${mimeType}` });
  }

  const fileName = updateData.profileImage.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-.]/g, '');
  const s3Key = `${env}/public/users/${userId}/profile/${fileName}`;

  uploadUrl = s3.getSignedUrl('putObject', {
    Bucket: ENV_AWS_BUCKET_NAME,
    Key: s3Key,
    ContentType: mimeType,
    Expires: 300
  });

  updateData.avatarUrl = s3Key;

  // Clean up unused fields
  delete updateData.profileImage;
  // delete updateData.mimeType;
}

  // 4. Update user record in DynamoDB
  try {
    updateData.updatedAt = new Date().toISOString();

    const updateExp = "SET " + Object.keys(updateData).map((k) => `#${k} = :${k}`).join(", ");
    const expAttrNames = Object.keys(updateData).reduce((acc, k) => ({ ...acc, [`#${k}`]: k }), {});
    const expAttrValues = Object.keys(updateData).reduce((acc, k) => ({ ...acc, [`:${k}`]: updateData[k] }), {});

    const result = await dynamoDb.update({
      TableName: USER_TABLE,
      Key: { userId },
      UpdateExpression: updateExp,
      ExpressionAttributeNames: expAttrNames,
      ExpressionAttributeValues: expAttrValues,
      ConditionExpression: "attribute_exists(userId)",
      ReturnValues: "ALL_NEW"
    }).promise();

    res.json({
      message: "User updated successfully",
      updatedAttributes: result.Attributes,
      ...(uploadUrl && { profileUploadUrl: uploadUrl })
    });
  } catch (err) {
    console.error("DynamoDB update error:", err);
    res.status(500).json({ error: "Failed to update user", details: err.message });
  }
});




app.delete('/delete/:userId', async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    // Fetch user record from DynamoDB
    const result = await dynamoDb.get({
      TableName: USER_TABLE,
      Key: { userId },
    }).promise();

    if (!result.Item) {
      return res.status(404).json({ error: 'User not found in DynamoDB' });
    }

    const { email } = result.Item;
    console.log('User record found:', result);
    if (!email) {
      return res.status(400).json({ error: 'email is missing in DynamoDB record' });
    }

    // Delete from DynamoDB
    await dynamoDb.delete({
      TableName: USER_TABLE,
      Key: { userId },
    }).promise();

    // Delete user from Cognito
    await cognitoIdentityServiceProvider.adminDeleteUser({
      UserPoolId: process.env.COGNITO_USER_POOL_ID,
      Username: email,
    }).promise();

    res.json({ message: 'User deleted from DynamoDB and Cognito successfully' });

  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Failed to delete user from DynamoDB or Cognito' });
  }
});
//
app.post('/follow', async (req, res) => {
  const { followerId, followeeId } = req.body;

  if (!followerId || !followeeId || followerId === followeeId) {
    return res.status(400).json({ error: 'Invalid or same user IDs' });
  }

  try {
    // Step 1: Verify both users exist
    const userCheck = await dynamoDb.batchGet({
      RequestItems: {
        [USER_TABLE]: {
          Keys: [
            { userId: followerId },
            { userId: followeeId }
          ],
          ProjectionExpression: 'userId'
        }
      }
    }).promise();

    const foundUsers = userCheck.Responses[USER_TABLE] || [];

    if (foundUsers.length < 2) {
      return res.status(404).json({ error: 'One or both user IDs do not exist' });
    }

    // Step 2: Add to UserFollows table (both directions)
    const timestamp = new Date().toISOString();

    const params = {
      RequestItems: {
        [USER_FOLLOW_TABLE]: [
          {
            PutRequest: {
              Item: {
                PK: `FOLLOW#${followerId}`, 
                SK: `USER#${followeeId}`, 
                direction: 'following',
                createdAt: timestamp
              }
            }
          },
          {
            PutRequest: {
              Item: {
                PK: `FOLLOW#${followeeId}`,
                SK: `USER#${followerId}`,
                direction: 'follower',
                createdAt: timestamp
              }
            }
          }
        ]
      }
    };

    await dynamoDb.batchWrite(params).promise();

    return res.json({ message: 'Followed successfully' });
  } catch (err) {
    console.error('Follow error:', err);
    return res.status(500).json({ error: 'Failed to follow user' });
  }
});

app.post('/unfollow', async (req, res) => {
  const { followerId, followeeId } = req.body;

  if (!followerId || !followeeId || followerId === followeeId) {
    return res.status(400).json({ error: 'Invalid or same user IDs' });
  }

  try {
    // Step 1: Verify both users exist
    const userCheck = await dynamoDb.batchGet({
      RequestItems: {
        [USER_TABLE]: {
          Keys: [
            { userId: followerId },
            { userId: followeeId }
          ],
          ProjectionExpression: 'userId'
        }
      }
    }).promise();

    const foundUsers = userCheck.Responses[USER_TABLE] || [];

    if (foundUsers.length < 2) {
      return res.status(404).json({ error: 'One or both user IDs do not exist' });
    }

    // Step 2: Delete both directions from UserFollows
    const deleteParams = {
      RequestItems: {
        [USER_FOLLOW_TABLE]: [
          {
            DeleteRequest: {
              Key: {
                PK: `FOLLOW#${followerId}`,
                SK: `USER#${followeeId}`
              }
            }
          },
          {
            DeleteRequest: {
              Key: {
                PK: `FOLLOW#${followeeId}`,
                SK: `USER#${followerId}`
              }
            }
          }
        ]
      }
    };

    await dynamoDb.batchWrite(deleteParams).promise();

    return res.json({ message: 'Unfollowed successfully' });
  } catch (err) {
    console.error('Unfollow error:', err);
    return res.status(500).json({ error: 'Failed to unfollow user' });
  }
});

// Get followers of a user
app.get('/:userId/followers', async (req, res) => {
  const { userId } = req.params;
  const { limit = 20, lastKey, pageOffset = 0 } = req.query;

  try {
    const parsedLimit = Number(limit);

    // Count total followers
    const countParams = {
      TableName: USER_FOLLOW_TABLE,
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: 'direction = :dir',
      ExpressionAttributeValues: {
        ':pk': `FOLLOW#${userId}`,
        ':dir': 'follower'
      },
      Select: 'COUNT'
    };

    const countResult = await dynamoDb.query(countParams).promise();
    const totalCount = countResult.Count || 0;
    const totalPages = Math.ceil(totalCount / parsedLimit);
    const currentPage = Math.floor(pageOffset / parsedLimit) + 1;

    // Fetch paginated follower IDs
    const queryParams = {
      TableName: USER_FOLLOW_TABLE,
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: 'direction = :dir',
      ExpressionAttributeValues: {
        ':pk': `FOLLOW#${userId}`,
        ':dir': 'follower'
      },
      Limit: parsedLimit
    };

    if (lastKey) {
      queryParams.ExclusiveStartKey = JSON.parse(Buffer.from(lastKey, 'base64').toString());
    }

    const result = await dynamoDb.query(queryParams).promise();
    const followerIds = result.Items.map(item => item.SK.replace('USER#', ''));

    if (followerIds.length === 0) {
      return res.json({
        followers: [],
        pagination: {
          totalCount,
          totalPages,
          currentPage,
          pageSize: parsedLimit,
          hasMore: false,
          lastKey: null
        }
      });
    }

    // Batch get follower profiles
    const keys = followerIds.map(id => ({ userId: id }));
    const profiles = await dynamoDb.batchGet({
      RequestItems: {
        [USER_TABLE]: {
          Keys: keys,
          ProjectionExpression: 'userId, firstName, lastName, email, avatarUrl'
        }
      }
    }).promise();

    const signedFollowers = (profiles.Responses[USER_TABLE] || []).map(user => {
      if (user.avatarUrl && !user.avatarUrl.startsWith('http')) {
        user.avatarUrl = fileService.getSignedMediaUrl(user.avatarUrl);
      }
      return user;
    });

    res.json({
      followers: signedFollowers,
      pagination: {
        totalCount,
        totalPages,
        currentPage,
        pageSize: parsedLimit,
        hasMore: !!result.LastEvaluatedKey,
        lastKey: result.LastEvaluatedKey
          ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
          : null
      }
    });

  } catch (err) {
    console.error('Error fetching followers:', err);
    res.status(500).json({ error: 'Failed to fetch followers' });
  }
});



// Get following of a user
app.get('/:userId/following', async (req, res) => {
  const { userId } = req.params;
  const { limit = 20, lastKey, pageOffset = 0 } = req.query;

  try {
    const parsedLimit = Number(limit);

    // Count total following entries
    const countParams = {
      TableName: USER_FOLLOW_TABLE,
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: 'direction = :dir',
      ExpressionAttributeValues: {
        ':pk': `FOLLOW#${userId}`,
        ':dir': 'following'
      },
      Select: 'COUNT'
    };

    const countResult = await dynamoDb.query(countParams).promise();
    const totalCount = countResult.Count || 0;
    const totalPages = Math.ceil(totalCount / parsedLimit);
    const currentPage = Math.floor(pageOffset / parsedLimit) + 1;

    // Fetch paginated following user IDs
    const queryParams = {
      TableName: USER_FOLLOW_TABLE,
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: 'direction = :dir',
      ExpressionAttributeValues: {
        ':pk': `FOLLOW#${userId}`,
        ':dir': 'following'
      },
      Limit: parsedLimit
    };

    if (lastKey) {
      queryParams.ExclusiveStartKey = JSON.parse(Buffer.from(lastKey, 'base64').toString());
    }

    const result = await dynamoDb.query(queryParams).promise();
    const followingIds = result.Items.map(item => item.SK.replace('USER#', ''));

    if (followingIds.length === 0) {
      return res.json({
        following: [],
        pagination: {
          totalCount,
          totalPages,
          currentPage,
          pageSize: parsedLimit,
          hasMore: false,
          lastKey: null
        }
      });
    }

    // Fetch full user details
    const keys = followingIds.map(id => ({ userId: id }));
    const profiles = await dynamoDb.batchGet({
      RequestItems: {
        [USER_TABLE]: {
          Keys: keys,
          ProjectionExpression: 'userId, firstName, lastName, email, avatarUrl'
        }
      }
    }).promise();

    const signedFollowing = (profiles.Responses[USER_TABLE] || []).map(user => {
      if (user.avatarUrl && !user.avatarUrl.startsWith('http')) {
        user.avatarUrl = fileService.getSignedMediaUrl(user.avatarUrl);
      }
      return user;
    });

    res.json({
      following: signedFollowing,
      pagination: {
        totalCount,
        totalPages,
        currentPage,
        pageSize: parsedLimit,
        hasMore: !!result.LastEvaluatedKey,
        lastKey: result.LastEvaluatedKey
          ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
          : null
      }
    });

  } catch (err) {
    console.error('Error fetching following:', err);
    res.status(500).json({ error: 'Failed to fetch following' });
  }
});









module.exports = app;
