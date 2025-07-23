// logs.js
require('dotenv').config();
const express = require('express');
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const app = express();
const cors = require("cors");
const env = process.env.APP_ENV || 'dev'; // 'dev', 'prod', etc.


const APP_ENV = process.env.APP_ENV;
const DYNAMODB_TABLE_USERS = process.env.DYNAMODB_TABLE_USERS;
const DYNAMODB_TABLE_CRASH_LOGS = process.env.DYNAMODB_TABLE_CRASH_LOGS;
const ENV_DYNAMODB_TABLE_USERS = `${APP_ENV}-${DYNAMODB_TABLE_USERS}`;
const ENV_DYNAMODB_TABLE_CRASH_LOGS = `${APP_ENV}-${DYNAMODB_TABLE_CRASH_LOGS}`;
// aws config for aws access
AWS.config.update({
  region: process.env.REGION,
  accessKeyId: process.env.ACCESS_KEY_ID,
  secretAccessKey: process.env.SECRET_ACCESS_KEY,
});

AWS.config.update({ region: process.env.REGION });
const dynamoDb = new AWS.DynamoDB.DocumentClient();

const CryptoJS = require("crypto-js");

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || key; // use .env for prod
function encryptData(data) {
  const ciphertext = CryptoJS.AES.encrypt(JSON.stringify(data), ENCRYPTION_KEY).toString();
  return ciphertext;
}

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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
    message: "Hello from path! Logs check File API is working!",
  });
});

app.post('/', async (req, res) => {
  const {
    userId,
    platform,
    appVersion,
    errorMessage,
    stackTrace,
    fileName,
    lineNumber,
    timestamp,
    context
  } = req.body;

  if (!errorMessage || !platform) {
    return res.status(400).json({ error: 'errorMessage and platform are required' });
  }

  if (userId) {
    // Validate that userId exists in the USERS table
    const userCheck = await dynamoDb.get({
      TableName: ENV_DYNAMODB_TABLE_USERS,
      Key: { userId },
    }).promise();

    if (!userCheck.Item) {
      return res.status(404).json({
        success: false,
        error: 'Invalid userId. User not found.',
      });
    }
  }

  const logEntry = {
    logId: uuidv4(),
    userId: userId || 'unknown',
    platform: platform,
    appVersion: appVersion || 'unknown',
    errorMessage: errorMessage,
    stackTrace: stackTrace || null,
    fileName: fileName || null,
    lineNumber: lineNumber || null,
    createdAt: timestamp || new Date().toISOString(),
    context: JSON.stringify(context)
  };

  // Saving crash log
  try {
    await dynamoDb.put({
      TableName: ENV_DYNAMODB_TABLE_CRASH_LOGS,
      Item: logEntry
    }).promise();

    res.status(200).json({ message: 'log record successfully', logId: logEntry.logId });
  } catch (err) {
    console.error('Error saving crash log:', err);
    res.status(500).json({ error: 'Failed to save log' });
  }
});

module.exports = app;

