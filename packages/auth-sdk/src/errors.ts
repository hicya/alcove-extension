export class AuthSdkError extends Error {
  readonly code: string;
  readonly status: number | undefined;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "AuthSdkError";
    this.code = code;
    this.status = status;
  }

  static async fromResponse(response: Response): Promise<AuthSdkError> {
    let code = "request_failed";
    let message = `HTTP ${response.status}`;

    try {
      const body = (await response.json()) as { error?: string; errorDescription?: string };
      if (body.error) {
        code = body.error;
      }
      if (body.errorDescription) {
        message = body.errorDescription;
      }
    } catch {
      // Response body wasn't JSON — use defaults
    }

    return new AuthSdkError(code, message, response.status);
  }
}
