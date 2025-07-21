// this script creates the users in the users_assets folder
// it reads the folder names as userIds and uploads profile images if available

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// 👇️ Set base path to your folders
const baseFolder = path.join(__dirname, 'users_assets');

// 👇️ Update this to your running API endpoint
const CREATE_USER_API = 'http://localhost:4001/user/create';

// 👇️ List of supported image MIME types
const mimeMap = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
};

// ✅ Helper: sanitize userId and file names
function sanitizeName(str) {
  return str.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9-_.]/g, '');
}

async function handleFolder(folder) {
  const sanitizedUserId = sanitizeName(folder);
  const folderPath = path.join(baseFolder, folder);

  const files = fs.readdirSync(folderPath);
  const profileImage = files.find(f => Object.keys(mimeMap).includes(path.extname(f).toLowerCase()));

  const mimeType = profileImage ? mimeMap[path.extname(profileImage).toLowerCase()] : null;
  const sanitizedProfileImage = profileImage ? sanitizeName(profileImage) : null;

  const userTypes = ['creator', 'fan', 'band', 'venue', 'label', 'record-store'];
  const userType = userTypes[Math.floor(Math.random() * userTypes.length)];

  const userPayload = {
    userId: sanitizedUserId,
    firstName: 'Test',
    lastName: sanitizedUserId,
    email: `${sanitizedUserId}@example.com`,
    phone: `91${Math.floor(Math.random() * 10000000000)}`,
    zipCode: '600001',
    userType,
    acceptPrivacyPolicy: true,
    acceptTerms: true,
    bio: `Hello, I am ${sanitizedUserId}`,
    profileImage: sanitizedProfileImage,
    mimeType
  };

  console.log(`Creating user: ${userPayload.userId}...`);

  try {
    const res = await axios.post(CREATE_USER_API, userPayload);
    const { profileUploadUrl } = res.data;

    if (profileUploadUrl && profileImage) {
      const filePath = path.join(folderPath, profileImage);
      const fileData = fs.readFileSync(filePath);

      await axios.put(profileUploadUrl, fileData, {
        headers: { 'Content-Type': mimeType }
      });

      console.log(`✅ Uploaded profile image for ${sanitizedUserId}`);
    }

    console.log(`✅ User created: ${sanitizedUserId}`);
  } catch (err) {
    console.error(`❌ Failed to create user ${sanitizedUserId}:`, err.response?.data || err.message);
  }
}

async function main() {
  const folders = fs.readdirSync(baseFolder).filter(f =>
    fs.statSync(path.join(baseFolder, f)).isDirectory()
  );

  // 🚀 Run all in parallel
  await Promise.all(folders.map(folder => handleFolder(folder)));
}

main();