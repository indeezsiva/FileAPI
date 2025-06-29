// Core Node.js & Express setup

// Task Summary – ACRCloud Audio Identification API Integration
// Integrated ACRCloud Audio Recognition API using secure HMAC-SHA1-based authentication.

// Implemented two endpoints:

// /identify-audio: Accepts audio file uploads via multipart/form-data.

// /identify-audio-url: Downloads audio from a provided URL and processes it.

// Sliced audio files into multiple 10-second chunks using FFmpeg (fluent-ffmpeg + ffmpeg-static) for better recognition accuracy.

// Sent each chunk to ACRCloud API, parsed the response, and stopped processing early if a confident match (score ≥ 70) was found.

// Cleaned up temporary audio files (chunks and original) after processing to avoid disk bloat.

const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const path = require('path');
const https = require('https');
const http = require('http');
const { promisify } = require('util');
const stream = require('stream');

const app = express();
const upload = multer({ dest: 'uploads/' }); // Temporary upload directory

// Promisified stream pipeline to handle async streaming
const pipeline = promisify(stream.pipeline);

// FFmpeg setup for audio processing
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);

// Function to slice a portion of audio file using ffmpeg
function sliceAudio(inputPath, startSec, durationSec, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(startSec) // where to start
      .duration(durationSec)  // how long to record
      .output(outputPath)
      .on('end', () => resolve(outputPath)) // when done
      .on('error', err => reject(err))      // if error
      .run();
  });
}

// ACRCloud credentials and config
const defaultOptions = {
  host: 'identify-ap-southeast-1.acrcloud.com',
  endpoint: '/v1/identify',
  signature_version: '1',
  data_type: 'audio',
  secure: true,
  access_key: 'a8d5f51f3683020bb26b703065620c69',
  access_secret: 'UaAzhPrC2MFdB2gOK9ZlYPGPCSg5pzWdqFtmKLm8'
};

// Build the string to sign as per ACRCloud authentication requirements
function buildStringToSign(method, uri, accessKey, dataType, signatureVersion, timestamp) {
  return [method, uri, accessKey, dataType, signatureVersion, timestamp].join('\n');
}

// Sign the string using HMAC-SHA1 and base64
function sign(signString, accessSecret) {
  return crypto.createHmac('sha1', accessSecret)
    .update(Buffer.from(signString, 'utf-8'))
    .digest().toString('base64');
}

// Identify audio by sending binary data to ACRCloud
function identify(data, options) {
  return new Promise((resolve, reject) => {
    const timestamp = Math.floor(Date.now() / 1000); // UNIX timestamp
    const stringToSign = buildStringToSign(
      'POST',
      options.endpoint,
      options.access_key,
      options.data_type,
      options.signature_version,
      timestamp
    );
    const signature = sign(stringToSign, options.access_secret); // Generate signature

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
    form.append('return', 'apple_music,spotify,deezer'); // enrich metadata

    // POST request to ACRCloud API
    axios.post(`http://${options.host}${options.endpoint}`, form, {
      headers: form.getHeaders()
    })
      .then(response => resolve(response.data))
      .catch(error => reject(error));
  });
}

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

  const downloadedPath = `uploads/from_url_${Date.now()}.mp3`;

  try {
    await downloadFileFromUrl(url, downloadedPath); // download audio

    const chunkLengthSec = 10;
    const maxChunks = 6;
    const chunkResults = [];

    for (let i = 0; i < maxChunks; i++) {
      const chunkPath = `uploads/chunk_${Date.now()}_${i}.wav`;
      const startSec = i * chunkLengthSec;

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

      if (matched) break; // early exit on first confident match
    }

    fs.unlinkSync(downloadedPath); // clean up downloaded file

    const bestMatch = chunkResults.find(c => c.matched);

    res.status(bestMatch ? 200 : 404).json({
      status: bestMatch ? 'match_found' : 'no_match',
      match: bestMatch || null,
      attempts: chunkResults
    });

  } catch (error) {
    console.error('Error identifying from URL:', error.message);
    res.status(500).json({ error: 'Failed to process audio URL', details: error.message });
  }
});

// Endpoint: Identify uploaded local audio file
app.post('/identify-audio', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file uploaded.' });
  }

  const originalPath = req.file.path;
  const chunkLengthSec = 10;
  const maxChunks = 6;
  const chunkResults = [];

  try {
    for (let i = 0; i < maxChunks; i++) {
      const chunkPath = `uploads/chunk_${Date.now()}_${i}.wav`;
      const startSec = i * chunkLengthSec;

      await sliceAudio(originalPath, startSec, chunkLengthSec, chunkPath);

      const chunkBuffer = fs.readFileSync(chunkPath);
      const result = await identify(chunkBuffer, defaultOptions);

      fs.unlinkSync(chunkPath); // remove chunk after use

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

      if (matched) {
        break; // stop on confident match
      }
    }

    fs.unlinkSync(originalPath); // remove original file

    const bestMatch = chunkResults.find(c => c.matched);

    res.status(bestMatch ? 200 : 404).json({
      status: bestMatch ? 'match_found' : 'no_match',
      match: bestMatch || null,
      attempts: chunkResults
    });
  } catch (error) {
    console.error('Identification failed:', error.message);
    res.status(500).json({ error: 'Failed to identify audio', details: error.message });
  }
});

module.exports = app;
