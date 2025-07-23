const AWS = require("aws-sdk");
const {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} = require("@aws-sdk/client-s3");


const APP_ENV = process.env.APP_ENV;
const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME;
const ENV_AWS_BUCKET_NAME = `${APP_ENV}-${AWS_BUCKET_NAME}`;
/** Set the credentials of S3 Client */
const s3 = new AWS.S3({
  region: process.env.REGION,
  credentials: {
    accessKeyId: process.env.ACCESS_KEY_ID, // Enter your aws user's accessKeyId
    secretAccessKey: process.env.SECRET_ACCESS_KEY, // Enter your aws user's secretAccessKey
  },
});

/** Set the credentials in S3Client */
const s3Client = new S3Client({
  credentials: {
    accessKeyId: process.env.ACCESS_KEY_ID, // Enter your aws user's accessKeyId
    secretAccessKey: process.env.SECRET_ACCESS_KEY, // Enter your aws user's secretAccessKey
  },
});

/**
 * Save file in s3 bucket
 * @param {Object} params
 * @param {string} params.Key Send object path, where you want to save object.
 * @param {string} params.Body Send file's buffer.
 * @param {string} [params.ContentType] Send a mimetype of file.
 */
exports.s3Upload = async (params) =>
  s3.upload(
    {
      Bucket: ENV_AWS_BUCKET_NAME,
      Key: params.Key,
      Body: params.Body,
      ContentType: params?.ContentType || "",
    },
    {},
    (err, data) =>
      err
        ? console.error(err?.message || "File uploading is failed!")
        : console.log("Upload success: ", data)
  );

/**
 * Save big object in s3 bucket
 * @param {Object} params
 * @param {string} params.Key Send object path, where you want to save object.
 * @param {string} params.Body Send file's buffer.
 */
exports.s3UploadMultiPart = async (params) => {
  let uploadId;
  try {
    /** Run CreateMultipartUploadCommand for get UploadId and start uploading by UploadId. */
    const multipartUpload = await s3Client.send(
      new CreateMultipartUploadCommand({
        Bucket: ENV_AWS_BUCKET_NAME,
        Key: params.Key,
      })
    );

    uploadId = multipartUpload.UploadId;

    const uploadPromises = [];
    // Multipart uploads require a minimum size of 10 MB per part.
    const minPartSize = 10 * 1024 * 1024; // 10 MB
    // Calculate part size to be within allowable range
    const partSize = Math.max(Math.ceil(params.Body.length / 100), minPartSize);
    // Calculate the number of parts
    const numParts = Math.ceil(params.Body.length / partSize);
    // Upload each part.
    for (let i = 0; i < numParts; i++) {
      const start = i * partSize;
      const end = Math.min(start + partSize, params.Body.length);

      uploadPromises.push(
        s3Client
          .send(
            new UploadPartCommand({
              Bucket:  ENV_AWS_BUCKET_NAME,
              Key: params.Key,
              UploadId: uploadId,
              Body: params.Body.slice(start, end),
              PartNumber: i + 1,
            })
          )
          .then((d) => d)
      );
    }

    // Upload each part at a time using Promise.all()
    const uploadResults = await Promise.all(uploadPromises);

    // Run CompleteMultipartUploadCommand after the upload all parts
    const completeUploading = await s3Client.send(
      new CompleteMultipartUploadCommand({
        Bucket:  ENV_AWS_BUCKET_NAME,
        Key: params.Key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: uploadResults.map(({ ETag }, i) => ({
            ETag,
            PartNumber: i + 1,
          })),
        },
      })
    );

    console.log("completeUploading = ", completeUploading);

    return {
      success: true,
      message: "Upload success!",
      data: completeUploading,
    };
  } catch (error) {
    if (uploadId) {
      // Run AbortMultipartUploadCommand if fetch error while upload parts.
      await s3Client.send(
        new AbortMultipartUploadCommand({
          Bucket:  ENV_AWS_BUCKET_NAME,
          Key: params.Key,
          UploadId: uploadId,
        })
      );
    }

    return {
      success: false,
      message: error?.message || "Multipart file uploading is failed!",
    };
  }
};

/**
 * Delete the object(file)
 * @param {Object} params
 * @param {string} params.Key Send object path, which file you want to delete.
 */
exports.s3DeleteObject = async (params) =>
  s3.deleteObject(
    {
      Bucket:  ENV_AWS_BUCKET_NAME,
      Key: params.Key,
    },
    (err, data) =>
      err
        ? console.error(err?.message || "File deleting is failed!")
        : console.log("Delete object success!: ", data)
  );

/**
 * Delete multiple objects(files)
 * @param {Object} params
 * @param {Object} params.Delete Send the objects path
 * @param {Object} params.Delete.Objects Send the array of object's Key
 * @param {string} params.Delete.Objects.Key Send the object path
 */
exports.s3DeleteObjects = async (params) =>
  s3.deleteObjects(
    {
      Bucket:  ENV_AWS_BUCKET_NAME,
      Delete: params.Delete,
    },
    (err, data) =>
      err
        ? console.error(err?.message || "Multiple files deleting is failed!")
        : console.log("Delete objects success!", data)
  );


  /**
 * Generate a signed GET URL for temporary media access
 * @param {string} s3Key - S3 object key
 * @param {number} expiresIn - URL expiry in seconds (default: 600s)
 * @returns {string} - Signed URL
 */
function getSignedMediaUrl(s3Key, expiresIn = 600) {
  return s3.getSignedUrl("getObject", {
    Bucket: ENV_AWS_BUCKET_NAME,
    Key: s3Key,
    Expires: expiresIn,
  });
}

/**
 * Attach signed GET URLs to mediaItems (playlist, post, etc.)
 * @param {Array} mediaItems - Items with { s3Key }
 * @returns {Array} - Items with added `mediaUrl`
 */
function addSignedUrlsToMediaItems(mediaItems = []) {
  return mediaItems.map(item => ({
    ...item,
    mediaUrl: item.s3Key ? getSignedMediaUrl(item.s3Key) : null,
  }));
}

module.exports.getSignedMediaUrl = getSignedMediaUrl;
module.exports.addSignedUrlsToMediaItems = addSignedUrlsToMediaItems;