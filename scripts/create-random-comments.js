// scripts/create-random-comments.js
const axios = require('axios');
const postId = `post-playlist-6360eca3-15d4-4321-95bc-0d6e7d3a2a80`;
const URL = 'http://localhost:4001/comments/posts/' + postId;
const USER_ID = '7881e3e0-c071-70fc-f66c-0b04caff8d71';
const NUM_COMMENTS = 120;

let randomComments = [
  'This playlist just boosted my mood!',
  'Every track is a gem. Well done!',
  'I keep coming back to this mix.',
  'Perfect soundtrack for my day.',
  'Discovered some new favorites here.',
  'The transitions are so smooth!',
  'Can’t believe how good this is.',
  'Exactly what I needed right now.',
  'This deserves way more likes.',
  'Instantly added to my library.',
  'Such a unique vibe throughout.',
  'You have amazing taste in music.',
  'This mix is pure gold.',
  'I’m sharing this with my friends!',
  'The energy here is contagious.',
  'On loop all day long.',
  'Playlist perfection!',
  'How did you pick such great songs?',
  'This is my new go-to playlist.',
  'Absolutely loving every minute!'
];

// Shuffle the array
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
randomComments = shuffle(randomComments);

async function createComment(index) {
  const commentText = randomComments[Math.floor(Math.random() * randomComments.length)];
  try {
    const res = await axios.post(URL, {
      userId: USER_ID,
      commentText
    });
    console.log(`(${index + 1}) Created comment:`, commentText, '| Status:', res.status);
  } catch (err) {
    console.error(`(${index + 1}) Error:`, err.response?.data || err.message);
  }
}

// Send all requests at once
(async () => {
  const tasks = Array.from({ length: NUM_COMMENTS }, (_, i) => createComment(i));
  await Promise.all(tasks);
})();
