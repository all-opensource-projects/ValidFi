import { Injectable, LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pino from 'pino';

export interface LogContext {
  requestId?: string;
  userId?: string;
  correlationId?: string;
  [key: string]: unknown;
}

@Injectable()
export class StructuredLoggerService implements LoggerService {
  private readonly logger: pino.Logger;

  constructor(private readonly configService: ConfigService) {
    const level = this.configService.get<string>('LOG_LEVEL') ?? 'info';
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';

    this.logger = pino({
      level,
      formatters: {
        level(label: string) {
          return { level: label };
        },
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      serializers: {
        err: pino.stdSerializers.err,
        req: pino.stdSerializers.req,
        res: pino.stdSerializers.res,
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'password',
          'token',
          'secret',
          'encryptionKey',
          'healthData',
          'medicalRecord',
        ],
        remove: true,
      },
      ...(isProduction
        ? {}
        : {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
              },
            },
          }),
    });
  }

  log(message: string, context?: LogContext): void {
    this.logger.info(context ?? {}, message);
  }

  error(message: string, trace?: string, context?: LogContext): void {
    this.logger.error({ ...context, err: trace ? new Error(trace) : undefined }, message);
  }

  warn(message: string, context?: LogContext): void {
    this.logger.warn(context ?? {}, message);
  }

  debug(message: string, context?: LogContext): void {
    this.logger.debug(context ?? {}, message);
  }

  verbose(message: string, context?: LogContext): void {
    this.logger.trace(context ?? {}, message);
  }

  child(context: LogContext): StructuredLoggerService {
    const childLogger = Object.create(StructuredLoggerService.prototype);
    childLogger.logger = this.logger.child(context);
    childLogger.configService = this.configService;
    return childLogger;
  }

  getPino(): pino.Logger {
    return this.logger;
  }
}
