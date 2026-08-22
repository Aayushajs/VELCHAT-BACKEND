import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { CollabService } from './collab.service';
import { PostClipDto, CreateCanvasDto, UpdateCanvasDto } from './collab.dto';

/** Clips + Canvas (§A4.7). Routed via the gateway under /clips and /canvas. */
@ApiTags('collab')
@ApiBearerAuth('access-token')
@Controller()
export class CollabController {
  constructor(private readonly collab: CollabService) {}

  // ── clips ──
  @Post('clips')
  @ApiOperation({ summary: 'Post a clip (short audio/video) to a conversation' })
  @ApiCreatedResponse({ description: 'Clip posted.' })
  postClip(@Body() body: PostClipDto) {
    return this.collab.postClip(body);
  }

  @Get('clips')
  @ApiOperation({ summary: 'List clips in a conversation' })
  @ApiQuery({ name: 'conversationId' })
  listClips(@Query('conversationId') conversationId: string) {
    return this.collab.listClips(conversationId);
  }

  @Delete('clips/:clipId')
  @ApiOperation({ summary: 'Delete a clip' })
  deleteClip(@Param('clipId') clipId: string) {
    return this.collab.deleteClip(clipId);
  }

  // ── canvas ──
  @Post('canvas')
  @ApiOperation({ summary: 'Create a collaborative canvas doc' })
  @ApiCreatedResponse({ description: 'Canvas created (version 1).' })
  createCanvas(@Body() body: CreateCanvasDto) {
    return this.collab.createCanvas(body);
  }

  @Get('canvas')
  @ApiOperation({ summary: 'List canvases in a conversation (metadata)' })
  @ApiQuery({ name: 'conversationId' })
  listCanvases(@Query('conversationId') conversationId: string) {
    return this.collab.listCanvases(conversationId);
  }

  @Get('canvas/:canvasId')
  @ApiOperation({ summary: 'Get a canvas with its content + version' })
  @ApiOkResponse({ description: 'Canvas doc.' })
  getCanvas(@Param('canvasId') canvasId: string) {
    return this.collab.getCanvas(canvasId);
  }

  @Patch('canvas/:canvasId')
  @ApiOperation({
    summary: 'Update a canvas (optimistic concurrency)',
    description: 'Pass expectedVersion; a concurrent edit → 409, reload and retry.',
  })
  updateCanvas(@Param('canvasId') canvasId: string, @Body() body: UpdateCanvasDto) {
    return this.collab.updateCanvas(canvasId, body.expectedVersion, {
      title: body.title,
      content: body.content,
      updatedBy: body.updatedBy,
    });
  }
}
