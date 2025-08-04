
exports.handler = async (event) => {
  console.log('pre-signup',event)
    const serviceUsers = [
      'hariprasad61298@gmail.com'    ];
    for(let i=0; i<=5; i=i+1){
  
      if(event.request.userAttributes.email == serviceUsers[i]){
        // Confirm the user
        event.response.autoConfirmUser = true;
  
          // Set the email as verified if it is in the request
            if (event.request.userAttributes.hasOwnProperty("email")) {
              event.response.autoVerifyEmail = true;
            }
            // Set the phone number as verified if it is in the request
            if (event.request.userAttributes.hasOwnProperty("phone_number")) {
              event.response.autoVerifyPhone = true;
            }
      }
    }
    return event;
  };