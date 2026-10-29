// Runs the in-memory test bucket (src/server/fake-s3.ts) as its own process, for the restart test:
// it outlives the app server, as a real bucket does. Prints its endpoint, then waits.
import { startFakeS3 } from "@/server/fake-s3";

const fake = await startFakeS3(process.env.FAKE_S3_KEY ?? "TESTACCESSKEY");
console.log(`FAKE_S3_ENDPOINT=${fake.endpoint}`);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => void fake.close().then(() => process.exit(0)));
