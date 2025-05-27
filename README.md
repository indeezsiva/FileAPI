# FileAPI
FileAPI – Upload & Download with AWS S3 & DynamoDB
==================================================

This is a Node.js + Express API for uploading, downloading, and managing file metadata using AWS S3 for storage and DynamoDB for metadata.

Features
--------
- Upload files to S3 using pre-signed URLs
- Download files using secure pre-signed URLs
- Store file metadata in DynamoDB
- View, update, and delete file metadata
- Swagger API documentation available at /api-docs

Setup
-----
1. Clone the repository:
   git clone https://github.com/indeezsiva/FileAPI.git

2. Install dependencies:
   npm install

3. Create a .env file with the following content:

REGION='us-west-2'
DYNAMODB_TABLE='file-system-db'
APP_ENV='dev'
AWS_BUCKET_NAME='file-system-scx'

Running the Server
------------------
Start the server:

   npm start

Access the server at:
   http://localhost:4000

Swagger Documentation:
   http://localhost:4000/api-docs

API Endpoints
-------------
GET    /health-check        - Health check
POST   /upload-url          - Generate pre-signed upload URL
POST   /download-url        - Generate pre-signed download URL
GET    /files               - List all files
GET    /files/:userId       - List files for a user
PATCH  /files/:userId       - Update metadata for a user
DELETE /delete-record       - Delete file metadata by userId
