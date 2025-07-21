// create new environment tables based on existing schema
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const {
  DynamoDBClient,
  CreateTableCommand,
  ListTablesCommand,
  TagResourceCommand,
  DescribeTableCommand
} = require('@aws-sdk/client-dynamodb');

const REGION = 'us-west-2'; // Change if needed
const ENV = process.env.ENV || 'test'; // Default to 'test' if ENV not set

const client = new DynamoDBClient({ region: REGION });


// Wait for table to be ACTIVE before tagging
async function waitForTableActive(tableName) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const describeRes = await client.send(new DescribeTableCommand({ TableName: tableName }));
    if (describeRes.Table.TableStatus === 'ACTIVE') {
      return describeRes.Table.TableArn;
    }
    console.log(`⏳ Waiting for ${tableName} to be ACTIVE...`);
    await new Promise(res => setTimeout(res, 3000));
  }
  throw new Error(`Timeout: Table ${tableName} not ACTIVE after waiting.`);
}

async function createEnvTables() {
  const raw = fs.readFileSync(path.join(__dirname, 'tables-schema.json'), 'utf-8');
  const tables = JSON.parse(raw);

  // Get existing tables
  const { TableNames } = await client.send(new ListTablesCommand({}));

  for (const table of tables) {
    const fullTableName = `${ENV}-${table.TableName}`;
    if (TableNames.includes(fullTableName)) {
      console.log(`⚠️  Table already exists: ${fullTableName}`);
      continue;
    }

    const input = {
      TableName: fullTableName,
      KeySchema: table.KeySchema,
      AttributeDefinitions: table.AttributeDefinitions,
      BillingMode: table.BillingMode || 'PAY_PER_REQUEST',
    };

    if (table.GlobalSecondaryIndexes) {
      input.GlobalSecondaryIndexes = table.GlobalSecondaryIndexes;
    }

    if (table.LocalSecondaryIndexes) {
      input.LocalSecondaryIndexes = table.LocalSecondaryIndexes;
    }

    try {
      const createCmd = new CreateTableCommand(input);
      await client.send(createCmd);
      console.log(`✅ Created table: ${fullTableName}`);

      // Wait for table ARN to become available
      const describeRes = await client.send(new DescribeTableCommand({ TableName: fullTableName }));
      const tableArn = await waitForTableActive(fullTableName);

      // Tag the table with STAGE=test
      const tagCmd = new TagResourceCommand({
        ResourceArn: tableArn,
        Tags: [{ Key: 'STAGE', Value: ENV }]
      });

      await client.send(tagCmd);
      console.log(`🏷️  Tagged ${fullTableName} with STAGE=${ENV}`);
    } catch (err) {
      console.error(`❌ Failed to create ${fullTableName}:`, err.message);
    }
  }
}

createEnvTables();
