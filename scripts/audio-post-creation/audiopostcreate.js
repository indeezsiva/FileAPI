const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const axios = require('axios');
const FormData = require('form-data');

// Configuration
const baseFolder = path.join(__dirname, 'audio_posts_assets');
const API_ENDPOINT = 'http://localhost:4001/posts/create-post/audio';

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.mp4'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

// ✅ Sanitize string for filenames and userIds
function sanitizeName(str) {
  return str.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9-_.]/g, '');
}

// ✅ Upload file to a pre-signed S3 URL
async function uploadFileToPresignedUrl(uploadUrl, filePath, mimeType) {
  const fileData = fs.readFileSync(filePath);
  await axios.put(uploadUrl, fileData, {
    headers: { 'Content-Type': mimeType }
  });
}

// ✅ Process one artist folder
async function processFolder(folder) {
  const folderPath = path.join(baseFolder, folder);
  const files = fs.readdirSync(folderPath);

  let audioFile, imageFile;

  // Log and match files
  console.log(`🔍 Folder: ${folder}`);
  files.forEach(f => {
    const ext = path.extname(f).toLowerCase();
    const mimeType = mime.lookup(f.toLowerCase());
    console.log(`  • ${f} → ext: ${ext}, mime: ${mimeType}`);
  });

  for (const f of files) {
    const fullPath = path.join(folderPath, f);
    if (!fs.statSync(fullPath).isFile()) continue;

    const ext = path.extname(f).toLowerCase();
    if (!audioFile && AUDIO_EXTENSIONS.includes(ext)) {
      audioFile = f;
    } else if (!imageFile && IMAGE_EXTENSIONS.includes(ext)) {
      imageFile = f;
    }

    if (audioFile && imageFile) break;
  }

  if (!audioFile || !imageFile) {
    console.warn(`⚠️ Skipping "${folder}" — Missing audio or image`);
    return;
  }

  // Full paths
  const audioPath = path.join(folderPath, audioFile);
  const imagePath = path.join(folderPath, imageFile);

  // Safe MIME fallback
  const audioMime = mime.lookup(audioFile) || 'audio/wav';
  const imageMime = mime.lookup(imageFile) || 'image/jpeg';

  const audioMeta = {
    fileName: audioFile,
    mimeType: audioMime
  };
  const coverImageMeta = {
    fileName: imageFile,
    mimeType: imageMime
  };

  const sanitizedUserId = sanitizeName(folder); // use folder name as userId
  const postTitle = folder;

  // Build form data
  const formData = new FormData();
  formData.append('userId', sanitizedUserId);
  formData.append('posttitle', postTitle);
  formData.append('mediaTitlename', postTitle);
  formData.append('resourceType', 'audio');
  formData.append('audioMeta', JSON.stringify(audioMeta));
  formData.append('coverImageMeta', JSON.stringify(coverImageMeta));
  formData.append('album', 'Demo Album');
  formData.append('artist', folder);
  formData.append('label', 'Unknown');
  formData.append('genre', 'Indie');
  formData.append('language', 'English');
  formData.append('duration', '180');
  formData.append('bitrate', '320');

  try {
    const { data } = await axios.post(API_ENDPOINT, formData, {
      headers: formData.getHeaders()
    });

    if (data?.uploadUrls?.audio) {
      await uploadFileToPresignedUrl(data.uploadUrls.audio.uploadUrl, audioPath, audioMime);
      console.log(`✅ Uploaded audio for "${folder}"`);
    }

    if (data?.uploadUrls?.coverImage) {
      await uploadFileToPresignedUrl(data.uploadUrls.coverImage.uploadUrl, imagePath, imageMime);
      console.log(`🖼️ Uploaded cover image for "${folder}"`);
    }
  } catch (err) {
    console.error(`❌ Error uploading for "${folder}":`, err.message);
  }
}

// ✅ Main runner
async function main() {
  const folders = fs.readdirSync(baseFolder).filter(f => {
    const fullPath = path.join(baseFolder, f);
    return fs.statSync(fullPath).isDirectory();
  });

  for (const folder of folders) {
    await processFolder(folder);
  }
}

main();
