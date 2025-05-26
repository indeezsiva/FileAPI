// this is a Node.js script to decrypt a given ciphertext using AES encryption
// Make sure to install the crypto-js library by running: npm install crypto-js 

const CryptoJS = require("crypto-js");

const ENCRYPTION_KEY = 'c738562fe9cd5e307c264543f3e518ead8c115c28dcad62c3f7f07f259d737d1'; // Replace with your actual encryption key
// Note: The key should be a 256-bit key (32 bytes) for AES-256 encryption
const ciphertext = "U2FsdGVkX1/rEOqHxiCdbe3w2UEI0bnDOCyy4QXcI41GwdubFdq0CXI0MCt1ThjCUx3b3E0DeekFO/akbGYwpkEeLrDsqyXpjYvwmISuDfqJLUCox78kk7aZNmuCOtelkXxl3MPZizhAmtO5orI6O2h9PY25K5gMRm2mizE+wEiNOI0ImYNl2y6O6/VKWe21POWIQEReihKCDTb1lu+MPgTf4PEBZfanQ5BgdwDs7UClzmLJYzgQT9JGffJUKqThaLvh7jDyD6Ns/wv97+XF2Y7/LHApmyjf6fy75B/wtwmsvAS5s3RvCPw9JA8PZfUxKxQASlfBG5R8hATjYyA7EHLw+L9uvX7z4zeHpGnvmIT3R3lhI/hF+qj6JYeZCBNGpIgZvoKDPPjOAmWvC23qDJHqFjR1gBQAJnYVlbq4LEQXK2S1hds4+RDkoE3Tj1U2PgL0HKcnu0rM+TahvO/pAkn08iYUVHyfLAUt7lo+TJjx0k73uOk4xxGv5ifA5FA/RqXqhU6LVsn/f4IK/QgDHNHES/TBwp5iXZZYRI6S3xbyUcBLIjTtpb/ZdIiTZ2VgbtiBaSoJBoL4i0ocAZibhNb4mJ1LT1Vk2M2aVW1bWzXNi+jN6Cf9+LdLib4QtPDce/AwoqbGnHSt849v2EwtnSJxixDgH9n/hi2sQPAXBFtdl1ACFfiVfLU3Kcv5tHsXOIRYQvkTvOWcC3WHkc6z8ZrW05MURzFOn0kJFDS2GDWEbFFhKLG4LjHynWNrcE7oI7HG+3crm+4hlVE2ATMg4X0Uio2HZ96q7hvIK8Ydyd5nC1uUc5uzQmu+ubWHZi/Y1LoOZl0uvZ3IDEEGLFzPNPKSfUwwy4cmn1wWTQ8zlGZBrWmcmqm0rvar5igUAFncfOvTWbSU2An3/UK1J3/fLbaPMlvFpW74CjBYTNEaApOBxEG1Z3Q39X1LWdaNxNldTwOc0OYyJcNYEx3UdeZd+FJ6j5AvCjCexWJ27pTd2kxpeI6ChSOZ7MfhPsvxSyciqlca3OCz3DRyOtmuaJpFPA6H29f+G9d8gCVwoNZiBJx8I88CniCmG8/9uKTDUr0Npzk4/boHgNeMhqlOYPskjadGAsl6YCcHYxbyTPerAAXg50kdGCLwKG41a33DKBUNlTd8/eAkVcDhM04fnpEvPs84HEop8whFGpMhah0lHcirzxUxeShXNQbdGX8yodeop1P/l6VFtN4SePsEWFAzaer0n6tIRvBv9khs2uRxUYJKMuW44bsYrZXsQL073QxcBKyYhuQanXyBXA56tO+amXEb1JvOeBmDzqOozRb/pHMWAO/dqeWROOHTshSp3XbVC32ZXrnrdkJFx/Vlkl4VhQ=="; 
// The ciphertext is a base64 encoded string that represents the encrypted JSON data

const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
const decrypted = bytes.toString(CryptoJS.enc.Utf8);
console.log("Decrypted JSON:", JSON.parse(decrypted));




// Dart code for reference

// void main() {
//   final ciphertext = 'PASTE_YOUR_CIPHERTEXT_HERE';
//   final passphrase = 'your-secret-key';

//   final decryptedJsonString = decryptWithCryptoJS(ciphertext, passphrase);
//   final jsonMap = jsonDecode(decryptedJsonString);

//   print(jsonMap);
// }



// import 'dart:convert';
// import 'package:encrypt/encrypt.dart' as encrypt;
// import 'package:crypto/crypto.dart';

// String decryptWithCryptoJS(String ciphertext, String passphrase) {
//   // Convert passphrase to 256-bit key (SHA256)
//   final key = encrypt.Key(sha256.convert(utf8.encode(passphrase)).bytes);

//   // Decode Base64 ciphertext (CryptoJS embeds salt/IV in OpenSSL format)
//   final encryptedBytes = base64.decode(ciphertext);

//   // Extract salt from the OpenSSL format
//   final saltHeader = utf8.decode(encryptedBytes.sublist(0, 8));
//   if (saltHeader != 'Salted__') {
//     throw Exception('Invalid CryptoJS encrypted data');
//   }

//   final salt = encryptedBytes.sublist(8, 16);

//   // Derive key & IV from passphrase and salt using OpenSSL's EVP_BytesToKey method
//   final derived = _evpBytesToKey(passphrase, salt);
//   final keyBytes = derived[0];
//   final ivBytes = derived[1];

//   final encrypter = encrypt.Encrypter(encrypt.AES(encrypt.Key(keyBytes), mode: encrypt.AESMode.cbc));
//   final iv = encrypt.IV(ivBytes);

//   final decrypted = encrypter.decrypt(encrypt.Encrypted(encryptedBytes.sublist(16)), iv: iv);
//   return decrypted;
// }

// // Equivalent of OpenSSL EVP_BytesToKey (MD5 based KDF)
// List<List<int>> _evpBytesToKey(String passphrase, List<int> salt) {
//   final pass = utf8.encode(passphrase);
//   List<int> key = [];
//   List<int> iv = [];

//   var dx = <int>[];
//   while (key.length + iv.length < 48) {
//     dx = md5.convert([...dx, ...pass, ...salt]).bytes;
//     if (key.length < 32) {
//       key += dx.take(32 - key.length);
//     } else {
//       iv += dx.take(16 - iv.length);
//     }
//   }

//   return [key, iv];
// }

