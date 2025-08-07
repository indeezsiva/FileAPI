// // this is a script to export DynamoDB table schemas to a JSON file
// // it can be used to create new environment tables with the same schema

const fs = require('fs');
const path = require('path');
const {
  DynamoDBClient,
  ListTablesCommand,
  DescribeTableCommand,
  ListTagsOfResourceCommand
} = require('@aws-sdk/client-dynamodb');
const {
  STSClient,
  GetCallerIdentityCommand
} = require('@aws-sdk/client-sts');

const REGION = 'us-west-2'; // ✅ your AWS region
const OUTPUT_FILE = path.join(__dirname, 'tables-schema.json');

const dynamoClient = new DynamoDBClient({ region: REGION });
const stsClient = new STSClient({ region: REGION });

let accountIdCache = null;

async function getAccountId() {
  if (!accountIdCache) {
    const response = await stsClient.send(new GetCallerIdentityCommand({}));
    accountIdCache = response.Account;
  }
  return accountIdCache;
}

async function hasStageDevTag(tableName) {
  const accountId = await getAccountId();
  const arn = `arn:aws:dynamodb:${REGION}:${accountId}:table/${tableName}`;

  const tagResp = await dynamoClient.send(
    new ListTagsOfResourceCommand({ ResourceArn: arn })
  );

  return tagResp.Tags?.some(tag => tag.Key === 'STAGE' && tag.Value === 'dev');
}

async function exportSchema() {
  const { TableNames } = await dynamoClient.send(new ListTablesCommand({}));
  const result = [];

  for (const tableName of TableNames) {
    const isDev = await hasStageDevTag(tableName);
    if (!isDev) continue;

    const { Table } = await dynamoClient.send(
      new DescribeTableCommand({ TableName: tableName })
    );

    const billingMode = Table.BillingModeSummary?.BillingMode || 'PAY_PER_REQUEST';

    const tableDef = {
      TableName: Table.TableName,
      KeySchema: Table.KeySchema,
      AttributeDefinitions: Table.AttributeDefinitions,
      BillingMode: billingMode
    };

    if (Table.GlobalSecondaryIndexes) {
      tableDef.GlobalSecondaryIndexes = Table.GlobalSecondaryIndexes.map(index => {
        const gsi = {
          IndexName: index.IndexName,
          KeySchema: index.KeySchema,
          Projection: index.Projection
        };

        if (billingMode === 'PROVISIONED' && index.ProvisionedThroughput) {
          const { ReadCapacityUnits, WriteCapacityUnits } = index.ProvisionedThroughput;
          gsi.ProvisionedThroughput = { ReadCapacityUnits, WriteCapacityUnits };
        }

        return gsi;
      });
    }

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
  console.log(`✅ Exported ${result.length} table schemas (stage=dev) to ${OUTPUT_FILE}`);
}

exportSchema().catch(console.error);
