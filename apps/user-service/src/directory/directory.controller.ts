import { Controller, Get, Put, Post, Delete, Body, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { DirectoryService } from './directory.service';
import { AddContactDto, DiscoverDto, RegisterHashDto, UpdateProfileDto } from './directory.dto';

/** Profiles, contacts, block, discovery (§B3). Routed via the gateway: /users /contacts. */
@ApiTags('directory')
@ApiBearerAuth('access-token')
@Controller()
export class DirectoryController {
  constructor(private readonly dir: DirectoryService) {}

  @Get('users/:userId/profile')
  @ApiOperation({ summary: 'Get a profile' })
  @ApiParam({ name: 'userId', description: 'Account_id.' })
  @ApiOkResponse({ description: 'Profile + privacy settings.' })
  getProfile(@Param('userId') userId: string) {
    return this.dir.getProfile(userId);
  }

  @Put('users/:userId/profile')
  @ApiOperation({ summary: 'Create/update a profile + privacy settings' })
  @ApiParam({ name: 'userId', description: 'Account_id.' })
  @ApiOkResponse({ description: 'Updated profile.' })
  updateProfile(@Param('userId') userId: string, @Body() body: UpdateProfileDto) {
    return this.dir.updateProfile(userId, body);
  }

  @Post('users/:userId/contacts')
  @ApiOperation({ summary: 'Add a contact' })
  @ApiParam({ name: 'userId', description: 'Owner account_id.' })
  @ApiCreatedResponse({ description: 'Contact added.' })
  addContact(@Param('userId') userId: string, @Body() body: AddContactDto) {
    return this.dir.addContact(userId, body.contactUserId, body.displayName, body.contactHash);
  }

  @Get('users/:userId/contacts')
  @ApiOperation({ summary: "List a user's contacts" })
  @ApiParam({ name: 'userId', description: 'Owner account_id.' })
  @ApiOkResponse({ description: 'Contacts with block state.' })
  listContacts(@Param('userId') userId: string) {
    return this.dir.listContacts(userId);
  }

  @Put('users/:userId/contacts/:contactUserId/block')
  @ApiOperation({ summary: 'Block a contact' })
  @ApiParam({ name: 'userId' })
  @ApiParam({ name: 'contactUserId' })
  @ApiOkResponse({ description: 'Blocked.' })
  block(@Param('userId') userId: string, @Param('contactUserId') contactUserId: string) {
    return this.dir.block(userId, contactUserId);
  }

  @Delete('users/:userId/contacts/:contactUserId/block')
  @ApiOperation({ summary: 'Unblock a contact' })
  @ApiParam({ name: 'userId' })
  @ApiParam({ name: 'contactUserId' })
  @ApiOkResponse({ description: 'Unblocked.' })
  unblock(@Param('userId') userId: string, @Param('contactUserId') contactUserId: string) {
    return this.dir.unblock(userId, contactUserId);
  }

  @Get('users/:userId/contacts/:contactUserId/blocked')
  @ApiOperation({ summary: 'Is this contact blocked?' })
  @ApiParam({ name: 'userId' })
  @ApiParam({ name: 'contactUserId' })
  @ApiOkResponse({ description: '{ blocked }.' })
  blocked(@Param('userId') userId: string, @Param('contactUserId') contactUserId: string) {
    return this.dir.isBlocked(userId, contactUserId);
  }

  @Put('directory/hash')
  @ApiOperation({
    summary: 'Opt in to discovery',
    description: 'Register a salted phone hash so others can find you (raw number never stored).',
  })
  @ApiQuery({ name: 'accountId', description: 'This user’s account_id.' })
  @ApiOkResponse({ description: 'Registered.' })
  registerHash(@Query('accountId') accountId: string, @Body() body: RegisterHashDto) {
    return this.dir.registerDiscoveryHash(accountId, body.phoneHash);
  }

  @Post('contacts/discover')
  @ApiOperation({
    summary: 'Privacy-preserving contact discovery',
    description:
      'Upload salted phone hashes → returns which are VelChat users. Non-matches discarded.',
  })
  @ApiOkResponse({ description: '{ matches: { hash: accountId } }.' })
  discover(@Body() body: DiscoverDto) {
    return this.dir.discover(body.hashes);
  }
}
