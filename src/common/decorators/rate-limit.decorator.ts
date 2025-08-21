import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rate_limit';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export const RateLimit = (options: RateLimitOptions) => {
  // Properly set metadata that the guard can read
  return SetMetadata(RATE_LIMIT_KEY, options);
}; 