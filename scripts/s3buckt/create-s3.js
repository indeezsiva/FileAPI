const {
  S3Client,
  CreateBucketCommand,
  PutBucketTaggingCommand,
  PutBucketCorsCommand,
  PutBucketVersioningCommand,
  PutPublicAccessBlockCommand,
  HeadBucketCommand
} = require('@aws-sdk/client-s3');

const REGION = 'us-west-2'; // Change this as needed
const STAGE = process.env.APP_ENV || 'dev';
const RAW_BUCKET_NAME = 'file-system-indeez'; // Passed in CLI
const BUCKET_NAME = `${STAGE}-${RAW_BUCKET_NAME}`; // e.g., dev-my-app-bucket

const s3 = new S3Client({ region: REGION });

async function bucketExists(bucketName) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
    return true;
  } catch {
    return false;
  }
}

async function createBucket() {
  if (!RAW_BUCKET_NAME) {
    console.error('❌ Bucket name required. Usage: STAGE=dev node create-s3-bucket.js <bucket-name>');
    process.exit(1);
  }

  const exists = await bucketExists(BUCKET_NAME);
  if (exists) {
    console.log(`⚠️ Bucket "${BUCKET_NAME}" already exists`);
    return;
  }

  try {
    // 1. Create bucket
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
    console.log(`✅ Created bucket: ${BUCKET_NAME}`);

    // 2. Add tags
    await s3.send(new PutBucketTaggingCommand({
      Bucket: BUCKET_NAME,
      Tagging: {
        TagSet: [
          { Key: 'stage', Value: STAGE }
        ]
      }
    }));
    console.log(`🏷️  Tagged with stage = ${STAGE}`);

    // 3. Enable versioning
    await s3.send(new PutBucketVersioningCommand({
      Bucket: BUCKET_NAME,
      VersioningConfiguration: {
        Status: 'Enabled'
      }
    }));
    console.log('📦 Versioning enabled');

    // 4. Block public access
    await s3.send(new PutPublicAccessBlockCommand({
      Bucket: BUCKET_NAME,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true
      }
    }));
    console.log('🔒 Public access blocked');

    // 5. Set CORS policy (optional)
    await s3.send(new PutBucketCorsCommand({
      Bucket: BUCKET_NAME,
      CORSConfiguration: {
        CORSRules: [{
          AllowedOrigins: ['*'],
          AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE'],
          AllowedHeaders: ['*'],
          MaxAgeSeconds: 3000
        }]
      }
    }));
    console.log('🌐 CORS policy set');
    
  } catch (err) {
    console.error(`❌ Error creating ${BUCKET_NAME}:`, err.message);
  }
}

createBucket();
