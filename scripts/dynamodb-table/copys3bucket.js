const { S3Client, ListObjectsV2Command, CopyObjectCommand } = require('@aws-sdk/client-s3');

const REGION = 'us-west-2';
const SOURCE_BUCKET = 'file-system-scx';         // your source bucket
const DEST_BUCKET = 'dev-file-system-indeez';       // your dev bucket

const s3 = new S3Client({ region: REGION });

async function copyAllS3Objects() {
  let continuationToken = undefined;
  let totalCopied = 0;

  do {
    const listParams = {
      Bucket: SOURCE_BUCKET,
      ContinuationToken: continuationToken,
    };

    const listResp = await s3.send(new ListObjectsV2Command(listParams));
    const objects = listResp.Contents || [];

    for (const obj of objects) {
      const copyParams = {
        Bucket: DEST_BUCKET,
        CopySource: `${SOURCE_BUCKET}/${obj.Key}`,
        Key: obj.Key,
      };

      await s3.send(new CopyObjectCommand(copyParams));
      console.log(`✅ Copied: ${obj.Key}`);
      totalCopied++;
    }

    continuationToken = listResp.IsTruncated ? listResp.NextContinuationToken : undefined;
  } while (continuationToken);

  console.log(`🎉 Finished copying ${totalCopied} objects from '${SOURCE_BUCKET}' to '${DEST_BUCKET}'`);
}

copyAllS3Objects().catch(console.error);
