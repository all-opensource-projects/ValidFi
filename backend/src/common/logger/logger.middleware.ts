import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { StructuredLoggerService } from './logger.service';

export interface RequestWithContext extends Request {
  requestId: string;
  correlationId: string;
  userId?: string;
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger: StructuredLoggerService;

  constructor(logger: StructuredLoggerService) {
    this.logger = logger;
  }

  use(req: RequestWithContext, res: Response, next: NextFunction): void {
    const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
    const correlationId = (req.headers['x-correlation-id'] as string) ?? requestId;

    req.requestId = requestId;
    req.correlationId = correlationId;

    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Correlation-Id', correlationId);

    const startTime = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const logContext = {
        requestId,
        correlationId,
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        duration,
        userAgent: req.headers['user-agent'],
        ip: req.ip,
      };

      if (res.statusCode >= 500) {
        this.logger.error('Request completed with server error', undefined, logContext);
      } else if (res.statusCode >= 400) {
        this.logger.warn('Request completed with client error', logContext);
      } else {
        this.logger.log('Request completed', logContext);
      }
    });

    next();
  }
}
