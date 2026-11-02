export type ServiceResult = {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
};

export const SOMETHING_WRONG = "Something went wrong on our side. Try again in a few minutes.";
export const CAPTCHA_FAILED = "Complete the check and try again.";

export function rateLimited(retryAfterSeconds: number, message: string): ServiceResult {
  return { status: 429, body: { error: message }, headers: { "Retry-After": String(retryAfterSeconds) } };
}
