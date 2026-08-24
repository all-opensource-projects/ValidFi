import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { StructuredLoggerService } from '../logger/logger.service';
import { RequestWithContext } from '../logger/logger.middleware';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: StructuredLoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithContext>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: any = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        message = (exceptionResponse as any).message || message;
        errors = (exceptionResponse as any).errors || null;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message,
      ...(errors && { errors }),
    };

    const logContext = {
      requestId: request.requestId,
      correlationId: request.correlationId,
      method: request.method,
      url: request.url,
      statusCode: status,
      userId: request.userId,
    };

    if (status >= 500) {
      this.logger.error(
        `Server error: ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : undefined,
        logContext,
      );
    } else {
      this.logger.warn(`Client error: ${request.method} ${request.url}`, logContext);
    }

    response.status(status).json(errorResponse);
  }
}
