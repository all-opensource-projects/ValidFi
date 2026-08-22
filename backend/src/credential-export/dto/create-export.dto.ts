import {
  IsEnum,
  IsArray,
  IsBoolean,
  IsOptional,
  ArrayMinSize,
  IsString,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ExportFormat } from '../credential-export.entity';

export class CreateExportDto {
  @IsEnum(ExportFormat)
  format: ExportFormat;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  credentialIds: string[];

  @IsBoolean()
  @IsOptional()
  includeMetadata?: boolean;

  @IsBoolean()
  @IsOptional()
  includeVersionHistory?: boolean;

  @IsBoolean()
  @IsOptional()
  encryptSensitiveData?: boolean;
}

export class BatchExportDto {
  @IsEnum(ExportFormat)
  format: ExportFormat;

  @IsOptional()
  @IsString()
  holderAddress?: string;

  @IsOptional()
  @IsString()
  credentialType?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsBoolean()
  @IsOptional()
  includeMetadata?: boolean;

  @IsBoolean()
  @IsOptional()
  includeVersionHistory?: boolean;

  @IsBoolean()
  @IsOptional()
  encryptSensitiveData?: boolean;

  @IsInt()
  @Min(1)
  @Max(1000)
  @IsOptional()
  batchSize?: number;
}
