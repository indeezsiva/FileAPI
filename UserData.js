// user.js
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
const dynamoDb = new AWS.DynamoDB.DocumentClient();


const USER_TABLE = process.env.DYNAMODB_TABLE_USERS;
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

  if (zipCode && (typeof zipCode !== 'string' || !/^\d{5}(-\d{4})?$/.test(zipCode))) {
    return res.status(400).json({ error: 'Valid zip code is required' });
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

    // const encrypted = encryptData({ files: data.Items });
    res.json({ users: data.Items });
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

    res.json({ users: data.Items });
  } catch (err) {
    console.error('Error fetching files:', err);
    res.status(500).send('Could not fetch files');
  }
});



app.patch("/update/:userId", async (req, res) => {
  const { userId } = req.params;
  const updateData = req.body;

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



app.delete('/users/delete', async (req, res) => {
  const { userId } = req.body;

  if (!fileId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    // Check if item exists
    const existing = await dynamoDb.get({
      TableName: USER_TABLE,
      Key: { userId }
    }).promise();

    if (!existing.Item) {
      return res.status(404).json({ error: 'Record not found for the given userId' });
    }

    // Delete the item
    await dynamoDb.delete({
      TableName: USER_TABLE,
      Key: { userId }
    }).promise();

    res.json({ message: 'Record deleted from DynamoDB successfully' });
  } catch (err) {
    console.error('DynamoDB delete error:', err);
    res.status(500).json({ error: 'Failed to delete record from DynamoDB' });
  }
});



module.exports = app;
