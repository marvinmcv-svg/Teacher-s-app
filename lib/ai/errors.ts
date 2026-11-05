export class MissingConfigError extends Error {
  constructor(what: string, envVars: string[]) {
    super(`${what} is not configured. Set ${envVars.join(", ")} (see .env.example and README → Setup).`);
    this.name = "MissingConfigError";
  }
}

/** The model declined (stop_reason "refusal"). Never turn this into a grade. */
export class AiRefusalError extends Error {
  constructor(public readonly category: string | null) {
    super(`The model declined this request${category ? ` (${category})` : ""}.`);
    this.name = "AiRefusalError";
  }
}

/** Output could not be used: truncated, unparseable, or failed business rules after retry. */
export class AiOutputError extends Error {
  constructor(
    message: string,
    public readonly details?: string,
  ) {
    super(message);
    this.name = "AiOutputError";
  }
}
