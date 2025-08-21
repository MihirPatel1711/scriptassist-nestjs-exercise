import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';

// Simple in-memory storage for rate limiting
// Note: For production, consider using Redis or similar distributed storage
const requestRecords: Record<string, { count: number, timestamp: number }[]> = {};

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    const ip = request.ip;
    
    // Get rate limit options from decorator metadata
    const rateLimitOptions = this.reflector.get<{ limit: number; windowMs: number }>(
      'rate_limit',
      context.getHandler(),
    ) || { limit: 100, windowMs: 60000 }; // Default: 100 requests per minute
    
    return this.handleRateLimit(ip, rateLimitOptions);
  }

  private handleRateLimit(ip: string, options: { limit: number; windowMs: number }): boolean {
    const now = Date.now();
    const { limit, windowMs } = options;
    
    // Initialize array for new IPs
    if (!requestRecords[ip]) {
      requestRecords[ip] = [];
    }
    
    // Clean old records outside the window
    const windowStart = now - windowMs;
    requestRecords[ip] = requestRecords[ip].filter(record => record.timestamp > windowStart);
    
    // Check if rate limit is exceeded
    if (requestRecords[ip].length >= limit) {
      throw new HttpException({
        status: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Rate limit exceeded',
        message: `Rate limit exceeded. Maximum ${limit} requests per ${windowMs / 1000} seconds.`,
        limit,
        current: requestRecords[ip].length,
        remaining: 0,
        retryAfter: Math.ceil(windowMs / 1000),
      }, HttpStatus.TOO_MANY_REQUESTS);
    }
    
    // Add current request
    requestRecords[ip].push({ count: 1, timestamp: now });
    
    // Cleanup old records periodically (every 1000 requests to avoid performance impact)
    if (Math.random() < 0.001) {
      this.cleanupOldRecords();
    }
    
    return true;
  }

  private cleanupOldRecords(): void {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes
    
    Object.keys(requestRecords).forEach(ip => {
      requestRecords[ip] = requestRecords[ip].filter(record => record.timestamp > now - maxAge);
      
      // Remove IP if no records remain
      if (requestRecords[ip].length === 0) {
        delete requestRecords[ip];
      }
    });
  }
} 