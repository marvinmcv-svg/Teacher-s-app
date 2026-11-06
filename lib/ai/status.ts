import "server-only";
import { nvidiaSelected } from "./nvidia";

/** Which AI provider is active and whether its key is present. Never exposes the key itself. */
export function aiProviderStatus(): { provider: string; envVar: string; configured: boolean } {
  if (nvidiaSelected())
    return { provider: "NVIDIA", envVar: "NVIDIA_API_KEY", configured: Boolean(process.env.NVIDIA_API_KEY) };
  return { provider: "Claude", envVar: "ANTHROPIC_API_KEY", configured: Boolean(process.env.ANTHROPIC_API_KEY) };
}
