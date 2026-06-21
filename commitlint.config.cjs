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
        // services
        'api-gateway',
        'realtime-gateway',
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
        // packages
        'proto',
        'shared-types',
        'common',
        'crypto',
        'config',
        // cross-cutting
        'deploy',
        'infra',
        'ci',
        'deps',
        'repo',
        'docs',
      ],
    ],
  },
};
