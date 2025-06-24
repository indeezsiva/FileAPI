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

// aws config for aws access
AWS.config.update({
  region: process.env.REGION,
  accessKeyId: process.env.ACCESS_KEY_ID,
  secretAccessKey: process.env.SECRET_ACCESS_KEY,
});
const s3 = new AWS.S3();

const cognitoIdentityServiceProvider = new AWS.CognitoIdentityServiceProvider();

const USER_TABLE = process.env.DYNAMODB_TABLE_USERS;
const USER_FOLLOW_TABLE = process.env.DYNAMODB_TABLE_USERS_FOLLOWS;
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
    avatarUrl,
    bio
  } = req.body;

  // Reject unknown fields
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
    'bio'
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

  // Input validations
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

  // if (!userType || !['admin', 'user', 'guest'].includes(userType)) {
  //   return res.status(400).json({ error: 'Valid userType is required (admin, user, guest)' });
  // }

  if (acceptPrivacyPolicy !== true || acceptTerms !== true) {
    return res.status(400).json({ error: 'Privacy policy and terms must be accepted' });
  }

  if (avatarUrl && typeof avatarUrl !== 'string') {
    return res.status(400).json({ error: 'avatarUrl must be a string' });
  }

  if (bio && typeof bio !== 'string') {
    return res.status(400).json({ error: 'bio must be a string' });
  }
  // Check for unique email and phone
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

  // Create user
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
      avatarUrl: avatarUrl || null,
      bio: bio || null,
      createdAt: new Date().toISOString()
    },
    ConditionExpression: 'attribute_not_exists(userId)'
  };

  try {
    await dynamoDb.put(params).promise();
    res.status(201).json({ message: 'User created', userId });
  } catch (error) {
    if (error.code === 'ConditionalCheckFailedException') {
      return res.status(409).json({ error: 'User already exists' });
    }
    console.error('Create user failed:', error);
    res.status(500).json({ error: 'Could not create user' });
  }
});
app.get('/', async (req, res) => {
  try {
    const data = await dynamoDb.scan({
      TableName: USER_TABLE
    }).promise();

    const encrypted = encryptData({ users: data.Items });
    res.json({ users: encrypted});
  } catch (err) {
    console.error('Error scanning files:', err);
    res.status(500).send('Could not fetch files');
  }
});

app.get('/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const data = await dynamoDb.query({
      TableName: USER_TABLE,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: {
        ':uid': userId
      }
    }).promise();
    const encrypted = encryptData({ users: data.Items });

    res.json({ users: encrypted });
  } catch (err) {
    console.error('Error fetching files:', err);
    res.status(500).send('Could not fetch files');
  }
});



app.patch("/update/:userId", async (req, res) => {
  const { userId } = req.params;
  const updateData = req.body;

  // Reject unknown fields
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
    'bio'
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

  if (!updateData || Object.keys(updateData).length === 0) {
    return res.status(400).json({ message: "No update fields provided" });
  }

  let updateExp = "SET ";
  const expAttrValues = {};
  const expAttrNames = {};

  updateData.updatedAt = new Date().toISOString();

  const updateClauses = Object.keys(updateData).map((key) => {
    const attrName = `#${key}`;
    const attrValue = `:${key}`;
    expAttrNames[attrName] = key;
    expAttrValues[attrValue] = updateData[key];
    return `${attrName} = ${attrValue}`;
  });

  updateExp += updateClauses.join(", ");

  const params = {
    TableName: USER_TABLE,
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

  try {
    const result = await dynamoDb.query({
      TableName: USER_FOLLOW_TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `FOLLOW#${userId}`
      },
      FilterExpression: 'direction = :dir',
      ExpressionAttributeValues: {
        ':pk': `FOLLOW#${userId}`,
        ':dir': 'follower'
      }
    }).promise();

    const followerIds = result.Items.map(item => item.SK.replace('USER#', ''));

    if (followerIds.length === 0) {
      return res.json({ followers: [] });
    }

    // Fetch full user info
    const keys = followerIds.map(id => ({ userId: id }));

    const profiles = await dynamoDb.batchGet({
      RequestItems: {
        [USER_TABLE]: {
          Keys: keys,
          ProjectionExpression: 'userId, firstName, lastName, email, avatarUrl'
        }
      }
    }).promise();

    const fullDetails = profiles.Responses[USER_TABLE] || [];

    res.json({ followers: fullDetails });

  } catch (err) {
    console.error('Error fetching followers:', err);
    res.status(500).json({ error: 'Failed to fetch followers' });
  }
});

// Get following of a user
app.get('/:userId/following', async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await dynamoDb.query({
      TableName: USER_FOLLOW_TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `FOLLOW#${userId}`
      },
      FilterExpression: 'direction = :dir',
      ExpressionAttributeValues: {
        ':pk': `FOLLOW#${userId}`,
        ':dir': 'following'
      }
    }).promise();

    const followingIds = result.Items.map(item => item.SK.replace('USER#', ''));

    if (followingIds.length === 0) {
      return res.json({ following: [] });
    }

    // Fetch full user info
    const keys = followingIds.map(id => ({ userId: id }));

    const profiles = await dynamoDb.batchGet({
      RequestItems: {
        [USER_TABLE]: {
          Keys: keys,
          ProjectionExpression: 'userId, firstName, lastName, email, avatarUrl'
        }
      }
    }).promise();

    const fullDetails = profiles.Responses[USER_TABLE] || [];

    res.json({ following: fullDetails });

  } catch (err) {
    console.error('Error fetching following:', err);
    res.status(500).json({ error: 'Failed to fetch following' });
  }
});




module.exports = app;
