function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey(): Promise<CryptoKey> {
  const secret = Deno.env.get("PAYMENT_TOKEN_ENCRYPTION_KEY") || "";
  if (secret.length < 32) throw new Error("PAYMENT_TOKEN_ENCRYPTION_KEY ausente ou curta");
  const keyBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptPaymentToken(token: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    new TextEncoder().encode(token),
  );
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

export async function decryptPaymentToken(ciphertext: string, iv: string): Promise<string> {
  const ivBytes = Uint8Array.from(base64ToBytes(iv));
  const encryptedBytes = Uint8Array.from(base64ToBytes(ciphertext));
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes.buffer },
    await encryptionKey(),
    encryptedBytes.buffer,
  );
  return new TextDecoder().decode(decrypted);
}
