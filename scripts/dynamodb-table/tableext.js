// this is a script to export DynamoDB table schemas to a JSON file
// it can be used to create new environment tables with the same schema
const fs = require('fs');
const path = require('path');
const {
  DynamoDBClient,
  ListTablesCommand,
  DescribeTableCommand,
} = require('@aws-sdk/client-dynamodb');

const REGION = 'us-west-2'; // change to your region
const OUTPUT_FILE = path.join(__dirname, 'tables-schema.json');

const client = new DynamoDBClient({ region: REGION });

async function exportSchema() {
  const listCommand = new ListTablesCommand({});
  const { TableNames } = await client.send(listCommand);

  const result = [];

  for (const tableName of TableNames) {
    const describeCmd = new DescribeTableCommand({ TableName: tableName });
    const { Table } = await client.send(describeCmd);

    const billingMode = Table.BillingModeSummary?.BillingMode || 'PAY_PER_REQUEST';

    const tableDef = {
      TableName: Table.TableName,
      KeySchema: Table.KeySchema,
      AttributeDefinitions: Table.AttributeDefinitions,
      BillingMode: billingMode
    };

    // Only include GSIs if present
    if (Table.GlobalSecondaryIndexes) {
      tableDef.GlobalSecondaryIndexes = Table.GlobalSecondaryIndexes.map(index => {
        const gsi = {
          IndexName: index.IndexName,
          KeySchema: index.KeySchema,
          Projection: index.Projection
        };

        // Only add provisioned throughput if billing is not PAY_PER_REQUEST
        if (billingMode === 'PROVISIONED' && index.ProvisionedThroughput) {
          const { ReadCapacityUnits, WriteCapacityUnits } = index.ProvisionedThroughput;
          if (ReadCapacityUnits > 0 && WriteCapacityUnits > 0) {
            gsi.ProvisionedThroughput = {
              ReadCapacityUnits,
              WriteCapacityUnits
            };
          }
        }

        return gsi;
      });
    }

    // Only include LSIs if present
    if (Table.LocalSecondaryIndexes) {
      tableDef.LocalSecondaryIndexes = Table.LocalSecondaryIndexes.map(index => ({
        IndexName: index.IndexName,
        KeySchema: index.KeySchema,
        Projection: index.Projection
      }));
    }

    result.push(tableDef);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
  console.log(`✅ Exported schema to ${OUTPUT_FILE}`);
}

exportSchema().catch(console.error);
