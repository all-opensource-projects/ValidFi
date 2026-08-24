import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import { RequestContextMiddleware, RequestWithContext } from './logger.middleware';
import { StructuredLoggerService } from './logger.service';

describe('RequestContextMiddleware', () => {
  let middleware: RequestContextMiddleware;
  let logger: StructuredLoggerService;
  let mockRequest: Partial<RequestWithContext>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestContextMiddleware,
        StructuredLoggerService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'LOG_LEVEL') return 'info';
              if (key === 'NODE_ENV') return 'test';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    middleware = module.get<RequestContextMiddleware>(RequestContextMiddleware);
    logger = module.get<StructuredLoggerService>(StructuredLoggerService);

    mockRequest = {
      headers: {},
      method: 'GET',
      originalUrl: '/api/v1/test',
      ip: '127.0.0.1',
    };

    mockResponse = {
      setHeader: jest.fn(),
      statusCode: 200,
      on: jest.fn(),
    };

    mockNext = jest.fn();
  });

  it('should be defined', () => {
    expect(middleware).toBeDefined();
  });

  it('should generate request ID if not provided', () => {
    middleware.use(
      mockRequest as RequestWithContext,
      mockResponse as Response,
      mockNext,
    );

    expect(mockRequest.requestId).toBeDefined();
    expect(mockRequest.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('should use provided request ID from header', () => {
    mockRequest.headers = { 'x-request-id': 'custom-req-id' };

    middleware.use(
      mockRequest as RequestWithContext,
      mockResponse as Response,
      mockNext,
    );

    expect(mockRequest.requestId).toBe('custom-req-id');
  });

  it('should set correlation ID equal to request ID if not provided', () => {
    middleware.use(
      mockRequest as RequestWithContext,
      mockResponse as Response,
      mockNext,
    );

    expect(mockRequest.correlationId).toBe(mockRequest.requestId);
  });

  it('should use provided correlation ID from header', () => {
    mockRequest.headers = { 'x-correlation-id': 'custom-corr-id' };

    middleware.use(
      mockRequest as RequestWithContext,
      mockResponse as Response,
      mockNext,
    );

    expect(mockRequest.correlationId).toBe('custom-corr-id');
  });

  it('should set response headers', () => {
    middleware.use(
      mockRequest as RequestWithContext,
      mockResponse as Response,
      mockNext,
    );

    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      'X-Request-Id',
      mockRequest.requestId,
    );
    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      'X-Correlation-Id',
      mockRequest.correlationId,
    );
  });

  it('should call next()', () => {
    middleware.use(
      mockRequest as RequestWithContext,
      mockResponse as Response,
      mockNext,
    );

    expect(mockNext).toHaveBeenCalled();
  });

  it('should register finish event handler', () => {
    middleware.use(
      mockRequest as RequestWithContext,
      mockResponse as Response,
      mockNext,
    );

    expect(mockResponse.on).toHaveBeenCalledWith('finish', expect.any(Function));
  });
});
