const swaggerJsdoc = require('swagger-jsdoc');
const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'File Upload API',
      version: '1.0.0',
      description: 'API for managing file uploads with S3 and DynamoDB',
    },
  },
  apis: ['./media.js'], // or point to multiple files
};

const swaggerSpec = swaggerJsdoc(options);
module.exports = swaggerSpec;
