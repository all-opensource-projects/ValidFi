import { ExportFormat, ExportStatus } from '../credential-export.entity';

export class ExportStatusResponseDto {
  id: string;
  status: ExportStatus;
  format: ExportFormat;
  credentialCount: number;
  fileSizeBytes: number;
  fileHash: string | null;
  storagePath: string | null;
  errorMessage: string | null;
  validationResults: Record<string, any> | null;
  createdAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
}

export class ExportValidationDto {
  isValid: boolean;
  credentialCount: number;
  totalSizeBytes: number;
  warnings: string[];
  errors: string[];
}

export class ExportDownloadDto {
  exportId: string;
  format: ExportFormat;
  data: string | Buffer;
  filename: string;
  mimeType: string;
  fileHash: string;
}
