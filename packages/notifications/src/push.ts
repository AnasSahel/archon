export async function sendPushNotification(
  topic: string,
  message: string
): Promise<void> {
  const ntfyUrl = process.env.NTFY_URL;
  if (!ntfyUrl) return;
  await fetch(`${ntfyUrl}/${topic}`, { method: "POST", body: message });
}
