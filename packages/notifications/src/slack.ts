export async function sendSlackNotification(
  webhookUrl: string,
  text: string
): Promise<void> {
  if (!webhookUrl) return;
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}
