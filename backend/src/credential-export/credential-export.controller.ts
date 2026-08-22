import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
  Request,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { CredentialExportService } from './credential-export.service';
import { CreateExportDto, BatchExportDto } from './dto/create-export.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Audit } from '../audit/audit.decorator';
import { AuditOperation } from '../audit/audit-log.entity';

@ApiTags('credential-export')
@Controller('credential-export')
@UseGuards(JwtAuthGuard)
@UseInterceptors(AuditInterceptor)
export class CredentialExportController {
  constructor(
    private readonly exportService: CredentialExportService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new credential export' })
  @ApiResponse({ status: 201, description: 'Export created successfully' })
  @Audit(AuditOperation.CREATED, { resourceType: 'credential-export' })
  async createExport(@Body() dto: CreateExportDto, @Request() req) {
    return this.exportService.createExport(dto, req.user.walletAddress);
  }

  @Post('batch')
  @ApiOperation({ summary: 'Create a batch export with filters' })
  @ApiResponse({ status: 201, description: 'Batch export created' })
  @Audit(AuditOperation.CREATED, { resourceType: 'credential-export-batch' })
  async createBatchExport(@Body() dto: BatchExportDto, @Request() req) {
    return this.exportService.createBatchExport(dto, req.user.walletAddress);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get export history for the authenticated user' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Returns export history' })
  async getExportHistory(
    @Request() req,
    @Query('limit') limit?: number,
  ) {
    return this.exportService.getExportHistory(
      req.user.walletAddress,
      limit ?? 20,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get export status by ID' })
  @ApiResponse({ status: 200, description: 'Returns export status' })
  async getExportStatus(@Param('id') id: string) {
    return this.exportService.getExportStatus(id);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download a completed export' })
  @ApiResponse({ status: 200, description: 'Returns export file' })
  async downloadExport(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const download = await this.exportService.downloadExport(id);

    res.set({
      'Content-Type': download.mimeType,
      'Content-Disposition': `attachment; filename="${download.filename}"`,
      'X-Export-Hash': download.fileHash,
    });

    if (Buffer.isBuffer(download.data)) {
      res.send(download.data);
    } else {
      res.send(download.data);
    }
  }

  @Get(':id/validate')
  @ApiOperation({ summary: 'Validate export integrity' })
  @ApiResponse({ status: 200, description: 'Returns validation results' })
  async validateExport(@Param('id') id: string) {
    return this.exportService.validateExportIntegrity(id);
  }
}
