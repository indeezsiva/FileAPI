# Lambda Functions

This folder contains AWS Lambda functions used for authentication workflows in the FileAPI project. Each file implements a specific step in the custom authentication challenge flow for AWS Cognito.

## Files

- **createAuth.js**
  - Generates a random 6-digit code and sends it to the user's email using AWS SES. Used to initiate a custom authentication challenge.

- **defineAuthLambda.js**
  - Determines the next step in the authentication process based on the user's session. Issues tokens if the challenge is passed, or presents a new challenge if not.

- **pre-signup.js**
  - Automatically confirms and verifies users whose email matches a predefined list during the signup process. Can also auto-verify phone numbers if present.

- **verifyAuthLambda.js**
  - Verifies if the code entered by the user matches the code sent to their email. Marks the challenge as correct or incorrect.

Each Lambda function is designed to be used as a trigger in AWS Cognito's custom authentication flow.
