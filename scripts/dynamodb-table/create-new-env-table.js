// // create new environment tables based on existing schema

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const {
  DynamoDBClient,
  CreateTableCommand,
  ListTablesCommand,
  TagResourceCommand,
  DescribeTableCommand,
  UpdateTableCommand
} = require('@aws-sdk/client-dynamodb');

const REGION = 'us-west-2'; // Change if needed
const ENV = process.env.ENV || 'dev'; // Default to 'test' if ENV not set

const client = new DynamoDBClient({ region: REGION });

async function waitForTableActive(tableName) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const { Table } = await client.send(new DescribeTableCommand({ TableName: tableName }));
    if (Table.TableStatus === 'ACTIVE') {
      return Table.TableArn;
    }
    console.log(`⏳ Waiting for ${tableName} to be ACTIVE...`);
    await new Promise(res => setTimeout(res, 3000));
  }
  throw new Error(`Timeout: Table ${tableName} not ACTIVE after waiting.`);
}

function extractIndexNames(indexes = []) {
  return indexes.map(i => i.IndexName);
}

async function createEnvTables() {
  const raw = fs.readFileSync(path.join(__dirname, 'tables-schema.json'), 'utf-8');
  const tables = JSON.parse(raw);

  const { TableNames } = await client.send(new ListTablesCommand({}));

  for (const table of tables) {
    const fullTableName = `${table.TableName}`;

    const tableExists = TableNames.includes(fullTableName);

    if (!tableExists) {
      const input = {
        TableName: fullTableName,
        KeySchema: table.KeySchema,
        AttributeDefinitions: table.AttributeDefinitions,
        BillingMode: table.BillingMode || 'PAY_PER_REQUEST'
      };

      if (table.GlobalSecondaryIndexes) {
        input.GlobalSecondaryIndexes = table.GlobalSecondaryIndexes;
      }

      if (table.LocalSecondaryIndexes) {
        input.LocalSecondaryIndexes = table.LocalSecondaryIndexes;
      }

      try {
        await client.send(new CreateTableCommand(input));
        console.log(`✅ Created table: ${fullTableName}`);

        const tableArn = await waitForTableActive(fullTableName);

        await client.send(new TagResourceCommand({
          ResourceArn: tableArn,
          Tags: [{ Key: 'STAGE', Value: ENV }]
        }));
        console.log(`🏷️  Tagged ${fullTableName} with STAGE=${ENV}`);
      } catch (err) {
        console.error(`❌ Failed to create ${fullTableName}:`, err.message);
      }
    } else {
      console.log(`⚠️  Table already exists: ${fullTableName}`);

      const { Table: existingTable } = await client.send(new DescribeTableCommand({ TableName: fullTableName }));

      const existingGSI = extractIndexNames(existingTable.GlobalSecondaryIndexes);
      const existingLSI = extractIndexNames(existingTable.LocalSecondaryIndexes);

      const schemaGSI = table.GlobalSecondaryIndexes || [];
      const schemaLSI = table.LocalSecondaryIndexes || [];

      // Add missing GSIs
     // Add missing GSIs (one at a time)
for (const gsi of schemaGSI) {
  if (!existingGSI.includes(gsi.IndexName)) {
    try {
      console.log(`➕ Adding missing GSI: ${gsi.IndexName} to ${fullTableName}`);
      await client.send(new UpdateTableCommand({
        TableName: fullTableName,
        AttributeDefinitions: table.AttributeDefinitions, // all attributes needed for GSIs
        GlobalSecondaryIndexUpdates: [
          { Create: gsi }
        ]
      }));

      // Wait until the GSI creation completes before continuing
      await waitForTableActive(fullTableName);

      console.log(`✅ Added GSI: ${gsi.IndexName}`);
    } catch (err) {
      console.error(`❌ Failed to add GSI ${gsi.IndexName}:`, err.message);
    }
  }
}
      // Add missing LSIs: ⚠️ LSIs cannot be added after table creation
      for (const lsi of schemaLSI) {
        if (!existingLSI.includes(lsi.IndexName)) {
          console.warn(`🚫 LSI ${lsi.IndexName} cannot be added after table creation. Consider table recreation.`);
        }
      }
    }
  }
}

createEnvTables().catch(console.error);
