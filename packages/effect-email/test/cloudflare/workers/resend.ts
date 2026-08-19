import * as Resend from "effect-email/resend";

export default {
  fetch(): Response {
    return new Response(`resend:${typeof Resend.ResendClient}:${typeof Resend.defaultLayer}`);
  },
};
