const lastEvaluatedKey = {
    "postId": "post-image-19521c4c-308e-4c3c-a1dc-d70dba54e73b",
    "createdAt": "2025-07-01T11:31:53.660Z"
}

const encodedKey = encodeURIComponent(JSON.stringify(lastEvaluatedKey));


console.log('encodedKey', encodedKey); // Output: %7B%22postId%22%3A%22post-image-19521c4c-308e-4c3c-a1dc-d70dba54e73b%22%7D