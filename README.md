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




# Serverless Express API Deployment Steps
==================================================

1. Install Node.js and Serverless Framework:
   npm install -g serverless

2. Configure AWS CLI (if not already):
   aws configure

3. Install project dependencies:
   npm install

4. Set up your .env file with environment variables:
   REGION=us-west-2
   DYNAMODB_TABLE=file-system-db
   AWS_BUCKET_NAME=file-system-scx
   ENCRYPTION_KEY=your-256-bit-hex-key

5. Configure Serverless credentials:
   serverless config credentials --provider aws --key YOUR_KEY --secret YOUR_SECRET

6. Deploy the service:
   serverless deploy

7. Get the deployed endpoint from the output URL.

8. To remove the service:
   serverless remove



# CI/CD Setup (GitHub Actions):
==================================================

1. Create a file at .github/workflows/deploy.yml

2. Add the following:
   name: Deploy Express API

   on:
     push:
       branches: [main]

   jobs:
     deploy:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v3
         - uses: actions/setup-node@v3
           with:
             node-version: '18'
         - run: npm install
         - uses: aws-actions/configure-aws-credentials@v2
           with:
             aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
             aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
             aws-region: us-west-2
         - run: npx serverless deploy

3. Add GitHub repository secrets:
   AWS_ACCESS_KEY_ID
   AWS_SECRET_ACCESS_KEY
   and other secrets 