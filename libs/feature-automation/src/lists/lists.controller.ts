import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { ListsService } from './lists.service';
import { CreateListDto, AddItemDto, UpdateItemDto } from './lists.dto';

/** Collaboration Lists (§A4.7) — channel-attached task lists. Routed via the gateway under /lists. */
@ApiTags('lists')
@ApiBearerAuth('access-token')
@Controller('lists')
export class ListsController {
  constructor(private readonly lists: ListsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a list in a channel/DM' })
  @ApiCreatedResponse({ description: 'List created.' })
  create(@Body() body: CreateListDto) {
    return this.lists.createList(body.conversationId, body.title, body.createdBy);
  }

  @Get()
  @ApiOperation({ summary: 'List the lists in a conversation' })
  @ApiQuery({ name: 'conversationId' })
  byConversation(@Query('conversationId') conversationId: string) {
    return this.lists.listByConversation(conversationId);
  }

  @Get(':listId')
  @ApiOperation({ summary: 'Get a list with its items' })
  @ApiOkResponse({ description: 'List + ordered items.' })
  get(@Param('listId') listId: string) {
    return this.lists.getList(listId);
  }

  @Delete(':listId')
  @ApiOperation({ summary: 'Delete a list (and its items)' })
  remove(@Param('listId') listId: string) {
    return this.lists.deleteList(listId);
  }

  @Post(':listId/items')
  @ApiOperation({ summary: 'Add an item to a list' })
  @ApiCreatedResponse({ description: 'Item added.' })
  addItem(@Param('listId') listId: string, @Body() body: AddItemDto) {
    return this.lists.addItem(listId, body.text, body.assignee, body.dueAt);
  }

  @Patch('items/:itemId')
  @ApiOperation({ summary: 'Update an item (text, done, assignee, due date, position)' })
  updateItem(@Param('itemId') itemId: string, @Body() body: UpdateItemDto) {
    return this.lists.updateItem(itemId, body);
  }

  @Delete('items/:itemId')
  @ApiOperation({ summary: 'Delete an item' })
  deleteItem(@Param('itemId') itemId: string) {
    return this.lists.deleteItem(itemId);
  }
}
