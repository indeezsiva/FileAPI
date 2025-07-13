const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const { promisify } = require('util');
const stream = require('stream');
const serverless = require('serverless-http');
const cors = require('cors');
const https = require('https');
const http = require('http');
const os = require('os');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: '/tmp/uploads/' });

// Promisify stream pipeline
const pipeline = promisify(stream.pipeline);

// FFmpeg configuration
const ffmpeg = require('fluent-ffmpeg');
const isLambda = !!process.env.LAMBDA_TASK_ROOT;

ffmpeg.setFfmpegPath(isLambda ? '/opt/bin/ffmpeg' : 'ffmpeg');
ffmpeg.setFfprobePath(isLambda ? '/opt/bin/ffprobe' : 'ffprobe');
if (!isLambda) {
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);
// const ffmpeg = require('fluent-ffmpeg');
// Function to slice a portion of audio file using ffmpeg
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
ffmpeg.setFfprobePath(ffprobeInstaller.path);

}
// Utility: Get audio duration
function getAudioDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        console.error('❌ ffprobe failed:', err.message);
        return reject(err);
      }
      resolve(metadata.format.duration);
    });
  });
}

// Utility: Slice audio into a 10-second chunk
function sliceAudio(inputPath, startSec, durationSec, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(startSec)
      .duration(durationSec)
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', err => {
        console.error('❌ ffmpeg slicing failed:', err.message);
        reject(err);
      })
      .run();
  });
}

// ACRCloud config
const defaultOptions = {
  host: 'identify-ap-southeast-1.acrcloud.com',
  endpoint: '/v1/identify',
  signature_version: '1',
  data_type: 'audio',
  secure: true,
  access_key: process.env.ACR_CLOUD_ACCESS_KEY,
  access_secret: process.env.ACR_CLOUD_SECRET_KEY
};

function buildStringToSign(method, uri, accessKey, dataType, signatureVersion, timestamp) {
  return [method, uri, accessKey, dataType, signatureVersion, timestamp].join('\n');
}

function sign(signString, accessSecret) {
  return crypto.createHmac('sha1', accessSecret)
    .update(Buffer.from(signString, 'utf-8'))
    .digest().toString('base64');
}

// Identify audio with ACRCloud
function identify(data, options) {
  return new Promise((resolve, reject) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const stringToSign = buildStringToSign(
      'POST',
      options.endpoint,
      options.access_key,
      options.data_type,
      options.signature_version,
      timestamp
    );
    const signature = sign(stringToSign, options.access_secret);

    const form = new FormData();
    form.append('sample', data, {
      filename: 'sample.wav',
      contentType: 'application/octet-stream',
    });
    form.append('sample_bytes', data.length);
    form.append('access_key', options.access_key);
    form.append('data_type', options.data_type);
    form.append('signature_version', options.signature_version);
    form.append('signature', signature);
    form.append('timestamp', timestamp);
    form.append('return', 'apple_music,spotify,deezer');

    axios.post(`http://${options.host}${options.endpoint}`, form, {
      headers: form.getHeaders()
    })
      .then(response => resolve(response.data))
      .catch(error => reject(error));
  });
}

// Health check
app.get("/", (req, res) => {
  return res.status(200).json({
    message: "✅ Audio API is running!",
    environment: isLambda ? 'lambda' : 'local',
  });
});

app.post('/identify-song', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file uploaded.' });
  }

  const originalPath = req.file.path;
  const chunkLengthSec = 10;
  const maxChunks = 6;
  const chunkResults = [];

  try {
    // ✅ Add delay to allow file system to flush upload
    await new Promise(resolve => setTimeout(resolve, 100));

    // Optional: Log file stats
    const fileStats = fs.statSync(originalPath);
    console.log(`Uploaded file size: ${fileStats.size} bytes`);

    const durationInSeconds = await getAudioDuration(originalPath);

    for (let i = 0; i < maxChunks; i++) {
      const startSec = i * chunkLengthSec;
      if (startSec >= durationInSeconds) break;

      const chunkPath = `/tmp/chunk_${Date.now()}_${i}.wav`;
      await sliceAudio(originalPath, startSec, chunkLengthSec, chunkPath);

      const chunkBuffer = fs.readFileSync(chunkPath);
      const result = await identify(chunkBuffer, defaultOptions);
      fs.unlinkSync(chunkPath);

      const score = result?.metadata?.music?.[0]?.score || 0;
      const matched = score >= 70;

      chunkResults.push({
        chunk: i + 1,
        start: startSec,
        end: startSec + chunkLengthSec,
        score,
        matched,
        title: result?.metadata?.music?.[0]?.title || null,
        artist: result?.metadata?.music?.[0]?.artists?.[0]?.name || null,
        raw: result
      });

      if (matched) break;
    }

    fs.unlinkSync(originalPath); // Cleanup original

    const bestMatch = chunkResults.find(c => c.matched);

    if (bestMatch) {
      const matchedData = bestMatch.raw?.metadata?.music?.[0];
      const structuredMetadata = {
        title: matchedData?.title || null,
        album: matchedData?.album?.name || null,
        artists: matchedData?.artists?.map(a => a.name) || [],
        label: matchedData?.label || null,
        releaseDate: matchedData?.release_date || null,
        genres: matchedData?.genres?.map(g => g.name) || [],
        duration: matchedData?.duration_ms ? matchedData.duration_ms / 1000 : null,
        externalLinks: {
          appleMusic: matchedData?.external_metadata?.apple_music || null,
          spotify: matchedData?.external_metadata?.spotify || null,
          deezer: matchedData?.external_metadata?.deezer || null,
        }
      };

      return res.status(200).json({
        status: 'match_found',
        duration: durationInSeconds,
        match: structuredMetadata,
        attempts: chunkResults
      });
    } else {
      return res.status(404).json({
        status: 'no_match',
        duration: durationInSeconds,
        match: null,
        attempts: chunkResults
      });
    }
  } catch (error) {
    console.error('Audio identification failed:', error.message);
    return res.status(500).json({ error: 'Failed to process audio', details: error.message });
  }
});



// Helper function: download audio file from a given URL and save it locally
async function downloadFileFromUrl(url, destPath) {
  const mod = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    const request = mod.get(url, response => {
      if (response.statusCode !== 200) {
        return reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
      }
      const fileStream = fs.createWriteStream(destPath);
      pipeline(response, fileStream) // stream to local file
        .then(() => resolve(destPath))
        .catch(reject);
    });
    request.on('error', reject);
  });
}
// Endpoint: Identify audio by downloading from a URL
app.post('/identify-audio-url', express.json(), async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'No URL provided' });
  }
// this one gives error in lambda due to tmp directory not being writable
  // const downloadedPath = `uploads/from_url_${Date.now()}.mp3`;
  
  // Use /tmp directory in Lambda, or system temp dir locally
  const tempDir = fs.existsSync('/tmp') ? '/tmp' : os.tmpdir();
  const downloadedPath = path.join(tempDir, `from_url_${Date.now()}.mp3`);

  try {
    await downloadFileFromUrl(url, downloadedPath); // download audio

    const chunkLengthSec = 10;
    const maxChunks = 6;
    const chunkResults = [];
    const durationInSeconds = await getAudioDuration(downloadedPath);
    console.log(`durationInSeconds: ${durationInSeconds}`);

    for (let i = 0; i < maxChunks; i++) {
            const startSec = i * chunkLengthSec;
      if (startSec >= durationInSeconds) break;

      // const chunkPath = `uploads/chunk_${Date.now()}_${i}.wav`;
      const chunkPath = path.join(tempDir, `chunk_${Date.now()}_${i}.wav`);

      await sliceAudio(downloadedPath, startSec, chunkLengthSec, chunkPath); // slice chunk

      const buffer = fs.readFileSync(chunkPath); // read buffer
      const result = await identify(buffer, defaultOptions); // identify chunk

      fs.unlinkSync(chunkPath); // clean up chunk

      const score = result?.metadata?.music?.[0]?.score || 0;
      const matched = score >= 70;

     chunkResults.push({
        chunk: i + 1,
        start: startSec,
        end: startSec + chunkLengthSec,
        score,
        matched,
        title: result?.metadata?.music?.[0]?.title || null,
        artist: result?.metadata?.music?.[0]?.artists?.[0]?.name || null,
        raw: result
      });

      if (matched) break;
    }

    fs.unlinkSync(downloadedPath); // clean up downloaded file

    const bestMatch = chunkResults.find(c => c.matched);

    if (bestMatch) {
      const matchedData = bestMatch.raw?.metadata?.music?.[0];
      const structuredMetadata = {
        title: matchedData?.title || null,
        album: matchedData?.album?.name || null,
        artists: matchedData?.artists?.map(a => a.name) || [],
        label: matchedData?.label || null,
        releaseDate: matchedData?.release_date || null,
        genres: matchedData?.genres?.map(g => g.name) || [],
        duration: matchedData?.duration_ms ? matchedData.duration_ms / 1000 : null,
        externalLinks: {
          appleMusic: matchedData?.external_metadata?.apple_music || null,
          spotify: matchedData?.external_metadata?.spotify || null,
          deezer: matchedData?.external_metadata?.deezer || null,
        }
      };

      return res.status(200).json({
        status: 'match_found',
        duration: durationInSeconds,
        match: structuredMetadata,
        attempts: chunkResults
      });
    } else {
      return res.status(404).json({
        status: 'no_match',
        duration: durationInSeconds,
        match: null,
        attempts: chunkResults
      });
    }

  } catch (error) {
    console.error('Error identifying from URL:', error.message);
    res.status(500).json({ error: 'Failed to process audio URL', details: error.message });
  }
});


// Export for Lambda
module.exports.handler = serverless(app);

// Start local server if not in Lambda
if (!isLambda) {
  const PORT = process.env.PORT || 4001;
  app.listen(PORT, () => {
    console.log(`🚀 Local server running at http://localhost:${PORT}`);
  });
}
