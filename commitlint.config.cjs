/**
 * Conventional Commits — enforced via husky commit-msg hook.
 * https://www.conventionalcommits.org/
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      1,
      'always',
      [
        // runtime services (six, since the 13 -> 6 consolidation)
        'edge-gateway',
        'identity',
        'messaging',
        'realtime',
        'content',
        'platform',
        'mono',
        // feature libraries — where the domains actually live
        'feature-auth',
        'feature-user',
        'feature-group-channel',
        'feature-chat',
        'feature-notification',
        'feature-search',
        'feature-realtime',
        'feature-presence',
        'feature-status',
        'feature-media',
        'feature-call',
        'feature-automation',
        'feature-ai',
        'feature-contracts',
        // shared packages
        'composition',
        'infra-context',
        'common',
        'config',
        'crypto',
        'database',
        'cache',
        'event-bus',
        'storage',
        'mail',
        'push',
        'proto',
        'shared-types',
        // cross-cutting
        'deploy',
        'infra',
        'ci',
        'deps',
        'repo',
        'docs',
        // short aliases kept so existing history and muscle memory still lint
        'auth',
        'user',
        'chat',
        'group-channel',
        'presence',
        'notification',
        'media',
        'search',
        'call',
        'automation',
        'ai',
      ],
    ],
  },
};
