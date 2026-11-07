export async function sendCode(email: string, code: string) {
  const key = process.env.RESEND_API_KEY,
    from = process.env.EMAIL_FROM;
  if (!key || !from) throw new Error("Transactional email is not configured");
  const result = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Your Dorcas Match verification code",
      text: `Your verification code is ${code}. It expires in 10 minutes. If you did not request it, ignore this email. Never share your code. Dorcas Match is an independent student project.`,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!result.ok) throw new Error("Email provider did not accept the message");
}
