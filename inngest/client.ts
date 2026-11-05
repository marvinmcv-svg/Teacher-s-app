import { Inngest } from "inngest";

// Event keys / signing keys come from INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY
// (or the local dev server: `pnpm dlx inngest-cli@latest dev`).
export const inngest = new Inngest({ id: "tinta" });
