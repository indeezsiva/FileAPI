const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand
} = require('@aws-sdk/lib-dynamodb');

// AWS Region
const REGION = 'us-west-2';

// Source and destination tables
const SOURCE_TABLE = 'posts';
const DEST_TABLE = 'dev-posts';

// Setup DynamoDB Document client
const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

async function copyAllUsersToDev() {
  try {
    let lastKey = undefined;
    let totalCopied = 0;

    do {
      const scanResult = await client.send(new ScanCommand({
        TableName: SOURCE_TABLE,
        ExclusiveStartKey: lastKey,
      }));

      const items = scanResult.Items || [];

      for (const item of items) {
        await client.send(new PutCommand({
          TableName: DEST_TABLE,
          Item: item,
        }));
        console.log(`✅ Copied user: ${item.userId || item.email}`);
        totalCopied++;
      }

      lastKey = scanResult.LastEvaluatedKey;
    } while (lastKey);

    console.log(`🎉 Finished copying ${totalCopied} users to '${DEST_TABLE}'`);
  } catch (err) {
    console.error('❌ Error copying users:', err);
  }
}

copyAllUsersToDev();
