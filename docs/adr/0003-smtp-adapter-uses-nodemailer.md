# SMTP Adapter Uses Nodemailer

Effect Email will expose the SMTP transport as `effect-email/smtp`, while implementing it with Nodemailer. The public boundary is named for the provider-neutral capability instead of the implementation library, and Nodemailer is preferred over emailjs or a hand-rolled SMTP client because SMTP protocol and MIME maturity matter more than TypeScript-native internals for this adapter.
