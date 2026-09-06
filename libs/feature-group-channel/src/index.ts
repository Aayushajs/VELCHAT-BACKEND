/** group-channel feature — owns no infrastructure; the composition root injects it. */
export { ChannelsModule } from './channels/channels.module';
// Exported so a single-process build can resolve membership DIRECTLY, instead of healing its
// own cache through its own HTTP API (routing + guard + shared secret, three silent failure modes).
export { ChannelsService } from './channels/channels.service';
