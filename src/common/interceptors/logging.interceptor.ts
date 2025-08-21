import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // 1. Log incoming requests with relevant details
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const method = req.method;
    const url = req.url;
    const now = Date.now();
    const requestId = this.generateRequestId();

    // 2. Measure and log response time
    // 3. Log outgoing responses
    // 4. Include contextual information like user IDs when available
    // 5. Avoid logging sensitive information
    this.logRequest(req, method, url, requestId);

    return next.handle().pipe(
      tap({
        next: (val) => {
          this.logResponse(req, res, method, url, now, requestId, 'success');
        },
        error: (err) => {
          this.logResponse(req, res, method, url, now, requestId, 'error', err);
        },
      }),
    );
  }

  private logRequest(req: any, method: string, url: string, requestId: string): void {
    const logData = {
      requestId,
      type: 'REQUEST',
      method,
      url,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id || 'anonymous',
      timestamp: new Date().toISOString(),
      headers: this.sanitizeHeaders(req.headers),
      query: req.query,
      body: this.sanitizeBody(req.body),
    };

    this.logger.log(`🚀 ${method} ${url}`, logData);
  }

  private logResponse(req: any, res: any, method: string, url: string, startTime: number, requestId: string, status: 'success' | 'error', error?: any): void {
    const duration = Date.now() - startTime;
    const responseSize = this.getResponseSize(res);

    const logData: any = {
      requestId,
      type: 'RESPONSE',
      method,
      url,
      status: status === 'success' ? res.statusCode : 'ERROR',
      duration: `${duration}ms`,
      responseSize: responseSize ? `${responseSize} bytes` : 'unknown',
      userId: req.user?.id || 'anonymous',
      timestamp: new Date().toISOString(),
    };

    if (status === 'success') {
      this.logger.log(`✅ ${method} ${url} - ${res.statusCode} (${duration}ms)`, logData);
    } else {
      logData.error = {
        message: error?.message || 'Unknown error',
        statusCode: error?.status || 500,
        stack: error?.stack,
      };
      this.logger.error(`❌ ${method} ${url} - ERROR (${duration}ms)`, logData);
    }
  }

  private sanitizeHeaders(headers: any): any {
    const sanitized = { ...headers };
    // Remove sensitive headers
    delete sanitized.authorization;
    delete sanitized.cookie;
    delete sanitized['x-api-key'];
    return sanitized;
  }

  private sanitizeBody(body: any): any {
    if (!body) return body;
    
    const sanitized = { ...body };
    // Remove sensitive fields
    delete sanitized.password;
    delete sanitized.token;
    delete sanitized.secret;
    delete sanitized.key;
    return sanitized;
  }

  private getResponseSize(res: any): number | null {
    try {
      return res.get('Content-Length') ? parseInt(res.get('Content-Length')) : null;
    } catch {
      return null;
    }
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
} 