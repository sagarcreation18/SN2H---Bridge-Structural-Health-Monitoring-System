import webpush from "web-push";
import { writeFile, mkdir } from "node:fs/promises";
await mkdir(".runtime", { recursive: true });
const keys = webpush.generateVAPIDKeys();
await writeFile(
  ".runtime/vapid-keys.env",
  `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n`,
  { flag: "wx", mode: 0o600 },
);
console.log(
  "Created .runtime/vapid-keys.env. Copy these two values into .env and set VAPID_SUBJECT to your real mailto: contact. Keep the private key secret.",
);
