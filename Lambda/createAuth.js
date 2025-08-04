import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import crypto from "crypto";

const ses = new SESClient({ region: "us-west-2" });

export const handler = async (event) => {
    let secretLoginCode;

  function generateRandomDigits(length = 6) {
    const digits = [];
    for (let i = 0; i < length; i++) {
      digits.push(crypto.randomInt(0, 10));
    }
    return digits;
  }

  if (!event.request.session || event.request.session.length === 0) {
    secretLoginCode = generateRandomDigits(6).join("");
    await sendEmail(event.request.userAttributes.email, secretLoginCode);
  } else {
    const previousChallenge = event.request.session.slice(-1)[0];
    const match = previousChallenge.challengeMetadata.match(/CODE-(\d*)/);
    secretLoginCode = match ? match[1] : "";
  }

  event.response.publicChallengeParameters = {
    email: event.request.userAttributes.email,
  };

  event.response.privateChallengeParameters = { secretLoginCode };
  event.response.challengeMetadata = `CODE-${secretLoginCode}`;

  return event;
};

async function sendEmail(emailAddress, secretLoginCode) {
  const command = new SendEmailCommand({
    Destination: { ToAddresses: [emailAddress] },
    Message: {
      Body: {
        Html: {
          Charset: "UTF-8",
          Data: `<p>Your login code is <strong>${secretLoginCode}</strong></p>`,
        },
        Text: { Charset: "UTF-8", Data: `Your login code is ${secretLoginCode}` },
      },
      Subject: { Charset: "UTF-8", Data: "Your secret login code" },
    },
    Source: process.env.SES_FROM_ADDRESS,
  });

  await ses.send(command);
}
