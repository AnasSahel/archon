export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.log(`[email] Would send to ${params.to}: ${params.subject}`);
    return;
  }
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL ?? "noreply@localhost",
      to: params.to,
      subject: params.subject,
      html: params.html,
    }),
  });
}
