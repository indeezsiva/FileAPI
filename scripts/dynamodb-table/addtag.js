
// this script adds a tag to all DynamoDB tables defined in tables-schema.json (exisiting)
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const {
  DynamoDBClient,
  TagResourceCommand,
  ListTablesCommand,
  DescribeTableCommand
} = require('@aws-sdk/client-dynamodb');

dotenv.config();

const REGION = 'us-west-2';
const ENV = process.env.ENV || 'local';
const TAG_KEY = 'STAGE';
const TAG_VALUE = ENV;

const client = new DynamoDBClient({ region: REGION });

async function tagTables() {
  const raw = fs.readFileSync(path.join(__dirname, 'tables-schema.json'), 'utf-8');
  const tables = JSON.parse(raw);

  const { TableNames } = await client.send(new ListTablesCommand({}));

  for (const table of tables) {
    const fullTableName = `${table.TableName}`;

    if (!TableNames.includes(fullTableName)) {
      console.warn(`⚠️  Table does not exist: ${fullTableName}`);
      continue;
    }

    try {
      const { Table } = await client.send(new DescribeTableCommand({ TableName: fullTableName }));
      const resourceArn = Table?.TableArn;

      if (!resourceArn) {
        console.error(`❌ Unable to resolve ARN for ${fullTableName}`);
        continue;
      }

      const tagCmd = new TagResourceCommand({
        ResourceArn: resourceArn,
        Tags: [{ Key: TAG_KEY, Value: TAG_VALUE }]
      });

      await client.send(tagCmd);
      console.log(`✅ Tagged ${fullTableName} with ${TAG_KEY}=${TAG_VALUE}`);
    } catch (err) {
      console.error(`❌ Error tagging ${fullTableName}:`, err.message);
    }
  }
}

tagTables();
