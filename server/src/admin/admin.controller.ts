import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AdminService } from './admin.service.js';
import { ReviewDocumentDto, FilterDocumentsDto } from './dto/review-document.dto.js';
import { AdminGuard } from '../common/admin.guard.js';
import type { AdminRequest } from '../common/admin.guard.js';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /** GET /admin/stats */
  @Get('stats')
  async getStats() {
    return this.adminService.getStats();
  }

  /** GET /admin/documents?status=... */
  @Get('documents')
  async getDocuments(@Query() query: FilterDocumentsDto) {
    return this.adminService.getDocuments(query.status);
  }

  /** POST /admin/documents/:id/approve */
  @Post('documents/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approveDocument(@Param('id') id: string, @Req() req: AdminRequest) {
    return this.adminService.approveDocument(id, req.actorId);
  }

  /** POST /admin/documents/:id/reject */
  @Post('documents/:id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectDocument(
    @Param('id') id: string,
    @Body() dto: ReviewDocumentDto,
    @Req() req: AdminRequest,
  ) {
    return this.adminService.rejectDocument(id, req.actorId, dto.reason);
  }

  /** POST /admin/documents/:id/manual-review */
  @Post('documents/:id/manual-review')
  @HttpCode(HttpStatus.OK)
  async markForManualReview(
    @Param('id') id: string,
    @Body() dto: ReviewDocumentDto,
    @Req() req: AdminRequest,
  ) {
    return this.adminService.markForManualReview(id, req.actorId, dto.reason);
  }

  /** POST /admin/documents/:id/ai-review */
  @Post('documents/:id/ai-review')
  @HttpCode(HttpStatus.OK)
  async aiReview(@Param('id') id: string, @Req() req: AdminRequest) {
    return this.adminService.analyzeDocumentWithAi(id, req.actorId);
  }
}
