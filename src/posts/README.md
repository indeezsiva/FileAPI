# Posts API Documentation

This module handles all post-related operations including creating, updating, and deleting posts. It supports both text and media posts.

## API Endpoints

## Create/Post Endpoints

### Create Text Post
- **Endpoint:** `POST /create-post/text`
- **Description:** Creates a new text post
- **Required Fields:**
  - `userId`: User ID of the post creator
  - `content`: Text content of the post
  - `posttitle`: Title of the post
- **Optional Fields:**
  - `privacy`: Privacy setting (default: 'public')
- **Response:**
  - Success (201): Returns created post object
  - Error (400): Missing fields or inappropriate language
  - Error (404): Invalid user ID
  - Error (500): Server error



### Identify Song from Uploaded Audio

- **Endpoint:** `POST /identify-song`
- **Description:** Accepts an uploaded audio file, slices it into chunks, and attempts to identify the song using audio fingerprinting. Returns structured metadata if a match is found. Intended for use before creating an audio post.

#### Request

- **Content-Type:** `multipart/form-data`
- **Form Field:**  
  - `audio`: The audio file to identify (required, e.g. `.mp3`, `.wav`)

#### Success Response (200)
```json
{
  "status": "match_found",
  "duration": 32.1,
  "match": {
    "title": "Song Title",
    "album": "Album Name",
    "artists": ["Artist 1", "Artist 2"],
    "label": "Label Name",
    "releaseDate": "2022-01-01",
    "genres": ["Pop", "Dance"],
    "duration": 180,
    "externalLinks": {
      "appleMusic": { /* Apple Music metadata */ },
      "spotify": { /* Spotify metadata */ },
      "deezer": { /* Deezer metadata */ }
    }
  },
  "attempts": [
    {
      "chunk": 1,
      "start": 0,
      "end": 10,
      "score": 85,
      "matched": true,
      "title": "Song Title",
      "artist": "Artist 1",
      "raw": { /* raw match data */ }
    }
    // ...more chunks if needed
  ]
}
```

#### No Match Response (404)
```json
{
  "status": "no_match",
  "duration": 32.1,
  "match": null,
  "attempts": [
    {
      "chunk": 1,
      "start": 0,
      "end": 10,
      "score": 42,
      "matched": false,
      "title": null,
      "artist": null,
      "raw": { /* raw data */ }
    }
    // ...more chunks if needed
  ]
}  
```

### Create Audio Post
- **Endpoint:** `POST /create-post/audio`
- **Description:** Creates a new audio post and generates pre-signed S3 URLs for uploading the audio and optional cover image. Stores audio metadata and associated post.

> **Tip:**  
> You can fetch audio metadata (such as title, album, artists, duration, genres, etc.) using the [`POST /identify-song`](#identify-song-from-uploaded-audio) API before creating an audio post. The metadata returned from `/identify-song` can be used to pre-fill the fields in your audio post creation payload.

#### Sample Payload (application/json)
```json
{
  "userId": "string (required)",
  "posttitle": "string (required)",
  "content": "string (optional)",
  "resourceType": "audio", // always 'audio'
  "privacy": "public", // or 'private' (optional, default: public)
  "mediaTitlename": "string (required)",
  "audioMeta": {
    "fileName": "track.mp3", // required
    "mimeType": "audio/mpeg" // required, e.g. audio/mpeg, audio/wav, etc.
  },
  "coverImageMeta": {
    "fileName": "cover.jpg", // optional
    "mimeType": "image/jpeg" // optional, e.g. image/jpeg, image/png, image/webp
  },
  "album": "string (optional)",
  "artist": "string (optional)",
  "duration": 180, // number, optional (in seconds)
  "genre": "string (optional)",
  "language": "string (optional)",
  "bitrate": 320000 // number, optional (in bps)
}
```

#### Success Response (200)
```json
{
  "success": true,
  "message": "Pre-signed URLs generated",
  "postId": "string",
  "audioId": "string",
  "uploadUrls": {
    "audio": {
      "uploadUrl": "signed S3 URL",
      "fileName": "track.mp3"
    },
    "coverImage": {
      "uploadUrl": "signed S3 URL",
      "fileName": "cover.jpg"
    }
  },
  "postData": { /* ...post metadata... */ }
}
```

#### How to Upload Files Using Pre-Signed URLs (Audio)
1. **Call the API** with the above payload to receive pre-signed URLs for audio and (optionally) cover image.
2. **Upload the audio file** using the returned `audio.uploadUrl`:
   ```js
   await fetch(response.uploadUrls.audio.uploadUrl, {
     method: 'PUT',
     body: audioFile, // your audio file blob or buffer
     headers: {
       'Content-Type': 'audio/mpeg' // must match audioMeta.mimeType
     }
   });
   ```
3. **Upload the cover image** (if provided) using the returned `coverImage.uploadUrl`:
   ```js
   await fetch(response.uploadUrls.coverImage.uploadUrl, {
     method: 'PUT',
     body: coverImageFile, // your image file blob or buffer
     headers: {
       'Content-Type': 'image/jpeg' // must match coverImageMeta.mimeType
     }
   });
   ```
**Notes:**
- Pre-signed URLs expire after 5 minutes (300 seconds).
- All fields in the payload are shown; only those marked required must be present.
- File names are sanitized automatically.
- Profanity checks are performed on title and content.
- The post status is 'pending_upload' until files are uploaded.

### Create Video Post
- **Endpoint:** `POST /create-post/video`
- **Description:** Creates a new video post and generates pre-signed S3 URLs for uploading the video and optional cover image. Stores video metadata and associated post.

#### Sample Payload (application/json)
```json
{
  "userId": "string (required)",
  "posttitle": "string (required)",
  "content": "string (optional)",
  "resourceType": "video", // always 'video'
  "privacy": "public", // or 'private' (optional, default: public)
  "mediaTitlename": "string (required)",
  "videoMeta": {
    "fileName": "video.mp4", // required
    "mimeType": "video/mp4" // required, e.g. video/mp4, video/webm, etc.
  },
  "coverImageMeta": {
    "fileName": "cover.jpg", // optional
    "mimeType": "image/jpeg" // optional, e.g. image/jpeg, image/png, image/webp
  },
  "duration": 120, // number, optional (in seconds)
  "resolution": "1920x1080", // string, optional
  "format": "mp4", // string, optional
}
```

#### Success Response (200)
```json
{
  "success": true,
  "message": "Pre-signed URLs generated",
  "postId": "string",
  "videoId": "string",
  "uploadUrls": {
    "video": {
      "uploadUrl": "signed S3 URL",
      "fileName": "video.mp4"
    },
    "coverImage": {
      "uploadUrl": "signed S3 URL",
      "fileName": "cover.jpg",
      "key": "dev/public/video/video-uuid/cover/cover.jpg"
    }
  },
  "postData": { /* ...post metadata... */ }
}
```

#### How to Upload Files Using Pre-Signed URLs (Video)
1. **Call the API** with the above payload to receive pre-signed URLs for video and (optionally) cover image.
2. **Upload the video file** using the returned `video.uploadUrl`:
   ```js
   await fetch(response.uploadUrls.video.uploadUrl, {
     method: 'PUT',
     body: videoFile, // your video file blob or buffer
     headers: {
       'Content-Type': 'video/mp4' // must match videoMeta.mimeType
     }
   });
   ```
3. **Upload the cover image** (if provided) using the returned `coverImage.uploadUrl`:
   ```js
   await fetch(response.uploadUrls.coverImage.uploadUrl, {
     method: 'PUT',
     body: coverImageFile, // your image file blob or buffer
     headers: {
       'Content-Type': 'image/jpeg' // must match coverImageMeta.mimeType
     }
   });
   ```
**Notes:**
- Pre-signed URLs expire after 5 minutes (300 seconds).
- All fields in the payload are shown; only those marked required must be present.
- File names are sanitized automatically.
- Profanity checks are performed on title and content.
- The post status is 'pending_upload' until files are uploaded.

### Create Image Post
- **Endpoint:** `POST /create-post/image`
- **Description:** Creates a new image post and generates pre-signed S3 URLs for uploading one or more images. Stores image metadata and associated post.

#### Sample Payload (application/json)
```json
{
  "userId": "string (required)",
  "posttitle": "string (required)",
  "content": "string (optional)",
  "resourceType": "image", // always 'image'
  "privacy": "public", // or 'private' (optional, default: public)
  "files": [
    {
      "fileName": "photo1.jpg", // required
      "mimeType": "image/jpeg", // required, e.g. image/jpeg, image/png, etc.
      "index": 0 // optional, for ordering
    },
    {
      "fileName": "photo2.png",
      "mimeType": "image/png",
      "index": 1
    }
  ]
}
```

#### Success Response (200)
```json
{
  "success": true,
  "message": "Pre-signed image upload URLs generated",
  "postId": "string",
  "mediaUploadUrls": [
    {
      "uploadUrl": "signed S3 URL",
      "fileName": "photo1.jpg",
      "key": "dev/public/image/image-uuid/photo1.jpg"
    },
    {
      "uploadUrl": "signed S3 URL",
      "fileName": "photo2.png",
      "key": "dev/public/image/image-uuid/photo2.png"
    }
  ],
  "postData": { /* ...post metadata... */ }
}
```

#### How to Upload Files Using Pre-Signed URLs (Image)
1. **Call the API** with the above payload to receive pre-signed URLs for each image file.
2. **Upload each image file** using the returned `mediaUploadUrls` array:
   ```js
   for (const img of response.mediaUploadUrls) {
     await fetch(img.uploadUrl, {
       method: 'PUT',
       body: imageFile, // your image file blob or buffer
       headers: {
         'Content-Type': 'image/jpeg' // must match the file's mimeType
       }
     });
   }
   ```
**Notes:**
- Pre-signed URLs expire after 5 minutes (300 seconds).
- All fields in the payload are shown; only those marked required must be present.
- File names are sanitized automatically.
- Profanity checks are performed on title and content.
- The post status is 'pending_upload' until files are uploaded.


## Create Audio Post (Share Existing Audio)

### Share Audio as a Post
- **Endpoint:** `POST /create-post/share-audio`
- **Description:** Publishes an existing uploaded audio (referenced by `audioId`) as a new post. The audio must already exist in the audio table.
- **Required Fields (JSON body):**
  - `userId`: User ID of the post creator
  - `posttitle`: Title of the post
  - `audioId`: ID of the existing audio to share as a post
- **Optional Fields:**
  - `content`: Text content of the post
  - `privacy`: Privacy setting (`public` or `private`, default: `public`)
  - `resourceType`: Should be `'audio'` (optional, will be set to `'audio'` by default)
- **Response:**
  - Success (200): Returns the created post object
  - Error (400): Missing required fields or inappropriate language
  - Error (404): Invalid user ID or audio not found
  - Error (500): Server error

#### Sample Request Payload
```json
{
  "userId": "string (required)",
  "posttitle": "string (required)",
  "audioId": "string (required)",
  "content": "string (optional)",
  "privacy": "public" // or "private" (optional)
}
```

#### Success Response (200)
```json
{
  "success": true,
  "message": "Audio post created successfully",
  "postId": "post-audio-uuid",
  "postData": {
    "postId": "post-audio-uuid",
    "userId": "string",
    "createdAt": "2025-08-06T12:34:56.789Z",
    "resourceType": "audio",
    "posttitle": "string",
    "content": "string or null",
    "mediaItems": [
      { /* audio metadata object from audio table */ }
    ],
    "privacy": "public",
    "status": "published",
    "views": 0,
    "commentsCount": 0,
    "active": true
  }
}
```

#### Error Responses
- **400 Bad Request:**  
  ```json
  {
    "error": "Missing required fields",
    "details": { "required": ["userId", "posttitle", "audioId"] }
  }
  ```
  or  
  ```json
  { "error": "Title contains inappropriate language." }
  ```
  or  
  ```json
  { "error": "Content contains inappropriate language." }
  ```
- **404 Not Found:**  
  ```json
  { "error": "Invalid userId. User not found." }
  ```
  or  
  ```json
  { "error": "audio not found" }
  ```
- **500 Internal Server Error:**  
  ```json
  { "error": "Internal Server Error" }
  ```

**Notes:**
- The audio referenced by `audioId` must already exist in the audio table.
- Profanity checks are performed on both `posttitle` and `content`.
- The post is immediately published and visible according to the specified privacy setting.


## Create Video Post (Share Existing Video)

### Share Video as a Post
- **Endpoint:** `POST /create-post/share-video`
- **Description:** Publishes an existing uploaded video (referenced by `videoId`) as a new post. The video must already exist in the video table.
- **Required Fields (JSON body):**
  - `userId`: User ID of the post creator
  - `posttitle`: Title of the post
  - `videoId`: ID of the existing video to share as a post
- **Optional Fields:**
  - `content`: Text content of the post
  - `privacy`: Privacy setting (`public` or `private`, default: `public`)
- **Response:**
  - Success (200): Returns the created post object
  - Error (400): Missing required fields or inappropriate language
  - Error (404): Invalid user ID or video not found
  - Error (500): Server error

#### Sample Request Payload
```json
{
  "userId": "string (required)",
  "posttitle": "string (required)",
  "videoId": "string (required)",
  "content": "string (optional)",
  "privacy": "public" // or "private" (optional)
}
```

#### Success Response (200)
```json
{
  "success": true,
  "message": "Video post created successfully",
  "postId": "post-video-uuid",
  "postData": {
    "postId": "post-video-uuid",
    "userId": "string",
    "createdAt": "2025-08-06T12:34:56.789Z",
    "resourceType": "video",
    "posttitle": "string",
    "content": "string or null",
    "mediaItems": [
      { /* video metadata object from video table */ }
    ],
    "privacy": "public",
    "status": "published",
    "views": 0,
    "commentsCount": 0,
    "active": true
  }
}
```

#### Error Responses
- **400 Bad Request:**  
  ```json
  {
    "error": "Missing required fields",
    "details": { "required": ["userId", "posttitle", "videoId"] }
  }
  ```
  or  
  ```json
  { "error": "Title contains inappropriate language." }
  ```
  or  
  ```json
  { "error": "Content contains inappropriate language." }
  ```
- **404 Not Found:**  
  ```json
  { "error": "Invalid userId. User not found." }
  ```
  or  
  ```json
  { "error": "video not found" }
  ```
- **500 Internal Server Error:**  
  ```json
  { "error": "Internal Server Error" }
  ```

**Notes:**
- The video referenced by `videoId` must already exist in the video table.
- Profanity checks are performed on both `posttitle` and `content`.
- The post is immediately published and visible according to the



## Create Playlist Post (Share Existing Playlist)

### Share Playlist as a Post
- **Endpoint:** `POST /create-post/playlist`
- **Description:** Publishes an existing playlist (referenced by `playlistId`) as a new post. The playlist must already exist in the playlists table.
- **Required Fields (JSON body):**
  - `userId`: User ID of the post creator
  - `posttitle`: Title of the post
  - `playlistId`: ID of the existing playlist to share as a post
- **Optional Fields:**
  - `content`: Text content of the post
  - `privacy`: Privacy setting (`public` or `private`, default: `public`)
  - `resourceType`: Should be `'playlist'` (optional, will be set to `'playlist'` by default)
- **Response:**
  - Success (200): Returns the created post object
  - Error (400): Missing required fields or inappropriate language
  - Error (404): Invalid user ID or playlist not found
  - Error (500): Server error

#### Sample Request Payload
    {
      "userId": "string (required)",
      "posttitle": "string (required)",
      "playlistId": "string (required)",
      "content": "string (optional)",
      "privacy": "public" // or "private" (optional)
    }

#### Success Response (200)
    {
      "success": true,
      "message": "Playlist post created successfully",
      "postId": "post-playlist-uuid",
      "postData": {
        "postId": "post-playlist-uuid",
        "userId": "string",
        "createdAt": "2025-08-06T12:34:56.789Z",
        "resourceType": "playlist",
        "posttitle": "string",
        "content": "string or null",
        "mediaItems": [
          {
            "playlistId": "string",
            "title": "string",
            "description": "string or null",
            "coverImageUrl": "string or null",
            "likesCount": 0,
            "tracks": 0
          }
        ],
        "privacy": "public",
        "status": "published",
        "views": 0,
        "commentsCount": 0,
        "active": true
      }
    }

#### Error Responses
- **400 Bad Request:**  
      {
        "error": "Missing required fields",
        "details": { "required": ["userId", "posttitle", "playlistId"] }
      }
  or  
      { "error": "Title contains inappropriate language." }
  or  
      { "error": "Content contains inappropriate language." }
- **404 Not Found:**  
      { "error": "Invalid userId. User not found." }
  or  
      { "error": "Playlist not found" }
- **500 Internal Server Error:**  
      { "error": "Internal Server Error" }

**Notes:**
- The playlist referenced by `playlistId` must already exist in the playlists table.
- Profanity checks are performed on both `posttitle` and `content`.
- The post is immediately published and visible according to the specified privacy setting.



## Share Saved Playlist as a Post

### Share a Saved Playlist
- **Endpoint:** `POST /create-post/saved-playlist`
- **Description:** Publishes a post using a playlist that the user has previously saved. The playlist must exist and be saved by the user.
- **Required Fields (JSON body):**
  - `userId`: User ID of the post creator
  - `posttitle`: Title of the post
  - `playlistId`: ID of the saved playlist to share as a post
- **Optional Fields:**
  - `content`: Text content of the post
  - `privacy`: Privacy setting (`public` or `private`, default: `public`)
- **Response:**
  - Success (200): Returns the created post object
  - Error (400): Missing required fields or inappropriate language
  - Error (403): Playlist not saved by user
  - Error (404): User or playlist not found
  - Error (500): Server error

#### Sample Request Payload
    {
      "userId": "string (required)",
      "posttitle": "string (required)",
      "playlistId": "string (required)",
      "content": "string (optional)",
      "privacy": "public" // or "private" (optional)
    }

#### Success Response (200)
    {
      "success": true,
      "message": "Saved playlist shared as post successfully",
      "postId": "post-playlist-uuid",
      "postData": {
        "postId": "post-playlist-uuid",
        "userId": "string",
        "createdAt": "2025-08-06T12:34:56.789Z",
        "resourceType": "playlist",
        "posttitle": "string",
        "content": "string or null",
        "mediaItems": [
          {
            "playlistId": "string",
            "title": "string",
            "description": "string or null",
            "coverImageUrl": "string or null",
            "likesCount": 0,
            "tracks": 0
          }
        ],
        "privacy": "public",
        "status": "published",
        "views": 0,
        "commentsCount": 0,
        "active": true
      }
    }

#### Error Responses
- **400 Bad Request:**  
      {
        "error": "Missing required fields",
        "details": { "required": ["userId", "posttitle", "playlistId"] }
      }
  or  
      { "error": "Post title contains inappropriate language." }
  or  
      { "error": "Post content contains inappropriate language." }
- **403 Forbidden:**  
      { "error": "You have not saved this playlist" }
- **404 Not Found:**  
      { "error": "User not found" }
  or  
      { "error": "Playlist not found" }
- **500 Internal Server Error:**  
      { "error": "Failed to share saved playlist" }

**Notes:**
- The playlist referenced by `playlistId` must exist and be saved by the user.
- Profanity checks are performed on both `posttitle` and `content`.
- The post is immediately published and visible according to the specified privacy setting.


### Update Operations

#### Update Text Post
- **Endpoint:** `PATCH /update-post/text/:postId`
- **Description:** Updates an existing text post
- **Required Parameters:**
  - `postId`: ID of the post to update
  - `userId`: User ID for authorization
- **Response:**
  - Success (200): Returns updated post object
  - Error (400): Missing required fields
  - Error (403): Unauthorized user
  - Error (404): Post not found
  - Error (500): Server error



#### Update Post Metadata
- **Endpoint:** `PATCH /update-post/metadata/:postId`
- **Description:** Updates post metadata without changing resource type
- **Required Parameters:**
  - `postId`: ID of the post
  - `userId`: User ID for authorization
- **Response:**
  - Success (200): Returns updated post object
  - Error (400): Missing fields
  - Error (403): Unauthorized user
  - Error (404): Post not found
  - Error (500): Server error

### Delete Operation

#### Delete Post
- **Endpoint:** `DELETE /delete-post/:postId`
- **Description:** Deletes a post and associated content (comments, reactions, media)
- **Required Parameters:**
  - `postId`: ID of the post to delete
- **Response:**
  - Success (200): Post deleted successfully
  - Error (400): Missing postId
  - Error (404): Post not found
  - Error (500): Server error


### Create Comment or Reply
- **Endpoint:** `POST /posts/:postId`
- **Description:** Adds a new comment to a post, or a reply to an existing comment. Performs profanity filtering and validates user, post, and parent comment (for replies).

#### Sample Payload (application/json)
```json
{
  "userId": "string (required)",
  "commentText": "string (required)",
  "parentCommentId": "string (optional)" // If replying to another comment
}
```

#### Success Response (201)
```json
{
  "success": true,
  "message": "Comment added", // or "Reply added" if parentCommentId is provided
  "data": {
    "commentId": "comment-uuid",
    "postId": "string",
    "userId": "string",
    "commentText": "string",
    "createdAt": "2025-08-07T12:34:56.789Z",
    "status": "active",
    "repliesCount": 0,
    "parentCommentId": "string" // only present for replies
  }
}
```

#### Error Responses
- **400 Bad Request:**  
  ```json
  {
    "error": "Missing required fields",
    "required": ["userId", "commentText"]
  }
  ```
  or  
  ```json
  { "success": false, "error": "Comment contains inappropriate language." }
  ```
- **404 Not Found:**  
  ```json
  { "error": "Invalid userId. User not found." }
  ```
  or  
  ```json
  { "error": "Invalid postId. Post not found." }
  ```
  or  
  ```json
  { "error": "Invalid parentCommentId. Parent comment not found." }
  ```
- **500 Internal Server Error:**  
  ```json
  { "error": "Failed to create comment" }
  ```

**Notes:**
- Profanity is checked in `commentText` using the `bad-words` filter.
- If `parentCommentId` is provided, the parent comment's `repliesCount` is incremented.
- Only valid users and posts can create comments.
- Replies are supported by specifying `parentCommentId`.


### Get Comments and Replies for a Post wiht reactions
- **Endpoint:** `GET /posts/:postId`
- **Description:** Retrieves paginated comments and replies for a post, including user profiles and reactions. Supports pagination via `limit` and `lastEvaluatedKey`.

#### Query Parameters
- `limit`: Number of comments to fetch per page (default: 10)
- `lastEvaluatedKey`: Pagination token (base64-encoded)

#### Success Response (200)
```json
{
  "success": true,
  "data": [
    {
      "commentId": "string",
      "postId": "string",
      "userId": "string",
      "commentText": "string",
      "createdAt": "2025-08-07T12:34:56.789Z",
      "status": "active",
      "repliesCount": 2,
      "parentCommentId": "string (optional)",
      "user": {
        "userId": "string",
        "firstName": "string",
        "lastName": "string",
        "email": "string",
        "avatarUrl": "string"
      },
      "reactionCounts": {
        "like": 3,
        "love": 1
      },
      "reactions": [
        {
          "reactionId": "string",
          "userId": "string",
          "reactionType": "like",
          "user": { /* user profile */ }
        }
      ],
      "replies": [ /* array of reply comments, same structure */ ]
    }
    // ...more comments
  ],
  "pagination": {
    "TotalCount": 12,
    "hasMore": true,
    "lastEvaluatedKey": "base64-string-or-null"
  }
}
```

#### Error Responses
- **500 Internal Server Error:**  
  ```json
  { "error": "Failed to get comments and replies" }
  ```

**Notes:**
- Comments are sorted by newest first.
- Replies are nested under their parent comment and also sorted by newest first.
- Each comment and reply includes user profile and reaction details.
- Use `lastEvaluatedKey` for paginated requests.  

### Update Comment
- **Endpoint:** `PATCH /posts/:postId/:commentId`
- **Description:** Updates the text of an existing comment or reply. Only the comment's author can edit their comment. Profanity filtering is enforced.

#### Sample Payload (application/json)
```json
{
  "userId": "string (required)",
  "commentText": "string (required)"
}
```

#### Success Response (200)
```json
{
  "success": true,
  "message": "Comment updated"
}
```

#### Error Responses
- **400 Bad Request:**  
  ```json
  { "error": "Missing userId or commentText" }
  ```
  or  
  ```json
  { "success": false, "error": "Comment contains inappropriate language." }
  ```
- **403 Forbidden:**  
  ```json
  { "error": "Unauthorized: not your comment" }
  ```
- **404 Not Found:**  
  ```json
  { "error": "Comment not found" }
  ```
- **500 Internal Server Error:**  
  ```json
  { "error": "Failed to update comment" }
  ```

**Notes:**
- Only the original author (`userId`) can update their comment.
- Profanity is checked in `commentText` using the `bad-words` filter.
- The comment's `status` is set to `"edited"` after update.



### Delete Comment (Cascade Delete)
- **Endpoint:** `DELETE /posts/:postId/:commentId`
- **Description:** Deletes a comment or reply and all its child replies and reactions for that comments too. Only the comment's author can delete their comment.

#### Sample Payload (application/json)
```json
{
  "userId": "string (required)"
}
```

#### Success Response (200)
```json
{
  "success": true,
  "message": "Comment and 2 replies deleted"
}
```

#### Error Responses
- **400 Bad Request:**  
  ```json
  { "error": "Missing userId" }
  ```
- **403 Forbidden:**  
  ```json
  { "error": "Unauthorized: Not your comment" }
  ```
- **404 Not Found:**  
  ```json
  { "error": "Comment not found" }
  ```
- **500 Internal Server Error:**  
  ```json
  { "error": "Failed to delete comment and replies" }
  ```

**Notes:**
- Only the original author (`userId`) can delete their comment.
- All direct replies to the comment are deleted in batches (max 25 per batch).
- The endpoint requires a GSI named `ParentCommentIndex` on `parentCommentId`.



### Add Reaction to Post or Comment
- **Endpoint:** `POST /reactions`
- **Description:** Adds a reaction (like, love, etc.) to a post or comment. Prevents duplicate reactions by the same user.

#### Sample Payload (application/json)
```json
{
  "userId": "string (required)",
  "postId": "string (required if not reacting to a comment)",
  "commentId": "string (optional, required if reacting to a comment)",
  "reactionType": "string (required)" // e.g. "like", "love", "laugh"
}
```

#### Success Response (201)
```json
{
  "success": true,
  "message": "Reaction added",
  "data": {
    "reactionId": "reaction-uuid",
    "userId": "string",
    "reactionType": "string",
    "createdAt": "2025-08-07T12:34:56.789Z",
    "postId": "string",
    "commentId": "string" // only present if reacting to a comment
  }
}
```

#### Error Responses
- **400 Bad Request:**  
  ```json
  { "error": "Missing required fields" }
  ```
- **409 Conflict:**  
  ```json
  { "success": false, "message": "User has already reacted with this type to the post or comment" }
  ```
- **500 Internal Server Error:**  
  ```json
  { "error": "Failed to add reaction" }
  ```

**Notes:**
- Users can only react once per type to a post, and only once to a comment.
- Reaction types are customizable (e.g., "like", "love", "laugh").




### Get Reactions for Post or Comment
- **Endpoint:** `GET /reactions`
- **Description:** Retrieves all reactions for a given post or comment, including user profile details for each reaction.

#### Query Parameters
- `postId`: ID of the post to fetch reactions for (optional if `commentId` is provided)
- `commentId`: ID of the comment to fetch reactions for (optional if `postId` is provided)

#### Success Response (200)
```json
{
  "success": true,
  "data": [
    {
      "reactionId": "string",
      "userId": "string",
      "reactionType": "string",
      "createdAt": "2025-08-07T12:34:56.789Z",
      "postId": "string",
      "commentId": "string", // only present if reaction is for a comment
      "user": {
        "userId": "string",
        "firstName": "string",
        "lastName": "string",
        "email": "string",
        "avatarUrl": "string"
      }
    }
    // ...more reactions
  ]
}
```

#### Error Responses
- **400 Bad Request:**  
  ```json
  { "error": "postId or commentId is required" }
  ```
- **500 Internal Server Error:**  
  ```json
  { "error": "Failed to fetch reactions" }
  ```

**Notes:**
- Each reaction includes the full user profile of the reacting user.
- Either `postId` or `commentId` must be provided.


### Delete Reaction (Authenticated)
- **Endpoint:** `DELETE /reactions/:reactionId`
- **Description:** Deletes a reaction by its ID. Only the user who created the reaction can delete it.

#### Sample Payload (application/json)
```json
{
  "userId": "string (required)"
}
```

#### Success Response (200)
```json
{
  "success": true,
  "message": "Reaction deleted"
}
```

#### Error Responses
- **400 Bad Request:**  
  ```json
  { "success": false, "error": "Missing userId" }
  ```
- **403 Forbidden:**  
  ```json
  { "success": false, "error": "You are not authorized to delete this reaction" }
  ```
- **404 Not Found:**  
  ```json
  { "success": false, "error": "Reaction not found" }
  ```
- **500 Internal Server Error:**  
  ```json
  { "success": false, "error": "Failed to delete reaction" }
  ```

**Notes:**
- Only the original author (`userId`) can delete their reaction.
- The endpoint expects `userId` in the request body.