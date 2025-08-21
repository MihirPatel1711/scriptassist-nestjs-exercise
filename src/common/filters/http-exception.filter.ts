import { ExceptionFilter, Catch, ArgumentsHost, HttpException, Logger, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    // 1. Log errors appropriately based on their severity
    this.logError(exception, request, status);

    // 2. Format error responses in a consistent way
    const errorResponse = this.formatErrorResponse(exception, request, status);

    // 3. Include relevant error details without exposing sensitive information
    // 4. Handle different types of errors with appropriate status codes
    response.status(status).json(errorResponse);
  }

  private logError(exception: HttpException, request: Request, status: number): void {
    const logLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'log';
    
    this.logger[logLevel](
      `HTTP ${status} - ${request.method} ${request.url}`,
      {
        status,
        method: request.method,
        url: request.url,
        userAgent: request.get('User-Agent'),
        ip: request.ip,
        userId: (request.user as any)?.id || 'anonymous',
        timestamp: new Date().toISOString(),
        error: exception.message,
      }
    );
  }

  private formatErrorResponse(exception: HttpException, request: Request, status: number): any {
    const baseResponse: any = {
      success: false,
      statusCode: status,
      message: this.getSafeErrorMessage(exception, status),
      path: request.url,
      timestamp: new Date().toISOString(),
      method: request.method,
    };

    // Add validation errors if available
    const exceptionResponse = exception.getResponse() as any;
    if (status === HttpStatus.BAD_REQUEST && exceptionResponse.message) {
      baseResponse.errors = exceptionResponse.message;
    }

    // Add retry information for server errors
    if (status >= 500) {
      baseResponse.retryAfter = 30;
    }

    return baseResponse;
  }

  private getSafeErrorMessage(exception: HttpException, status: number): string {
    if (status >= 500) {
      return 'Internal server error';
    }

    // For client errors, just return the original message
    return exception.message || 'An error occurred';
  }
} 