export const handler = async (event) => {
  console.log('VerifyAuthChallengeResponse event:', JSON.stringify(event, null, 2));
  console.log('VerifyAuthChallengeResponse event:', JSON.stringify(event, null, 2));

  const expectedAnswer = event.request.privateChallengeParameters?.secretLoginCode;
  const userAnswer = event.request.challengeAnswer;
  console.log('VerifyAuthChallengeResponse event:', JSON.stringify(event, null, 2));

  event.response.answerCorrect = userAnswer === expectedAnswer;

  return event;
};
