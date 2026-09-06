import { loadConfig } from './index';

/**
 * `.env` values that carry a trailing comment (§ops).
 *
 * `docker compose --env-file` and `env_file:` do NOT strip inline comments: everything after `=`
 * becomes the value, whitespace and `# …` included. A line that looks completely ordinary —
 *
 *     OTP_TEMPLATE=VelChat            # DLT-approved template name
 *
 * — therefore reaches the process as `"VelChat            # DLT-approved template name"`, which
 * the SMS provider rejects. The service still boots, /health still says ok, and the only symptom
 * is a 502 on login with no indication of why. Values are sanitised at the boundary so a comment
 * costs a confusing outage no more than once.
 */
describe('loadConfig — values with trailing comments', () => {
  const base = {
    NODE_ENV: 'production',
    SERVICE_NAME: 'velchat-mono',
    JWT_ISSUER: 'https://auth.velchat.local',
  } as NodeJS.ProcessEnv;

  it('strips an inline comment from a value', () => {
    const cfg = loadConfig({
      ...base,
      OTP_TEMPLATE: 'VelChat            # DLT-approved 2Factor SMS template name',
    });
    expect(cfg.OTP_TEMPLATE).toBe('VelChat');
  });

  it('strips one from a secret too, rather than sending a broken key upstream', () => {
    const cfg = loadConfig({
      ...base,
      OTP_API_KEY: '00000000-0000-4000-8000-000000000000   # DEV key — never commit',
    });
    expect(cfg.OTP_API_KEY).toBe('00000000-0000-4000-8000-000000000000');
  });

  it('keeps a strict enum parseable instead of failing the whole boot', () => {
    const cfg = loadConfig({
      ...base,
      OTP_DEV_MODE: 'false        # while true, only OTP_DEV_PHONE may receive an OTP',
    });
    expect(cfg.OTP_DEV_MODE).toBe(false);
  });

  it('trims stray trailing whitespace', () => {
    const cfg = loadConfig({ ...base, OTP_DEV_PHONE: '+919302633266  ' });
    expect(cfg.OTP_DEV_PHONE).toBe('+919302633266');
  });

  it('leaves a legitimate # inside a value alone', () => {
    // Only whitespace-then-# starts a comment — the dotenv convention. A password of "p#ss"
    // or a fragment URL must survive untouched.
    const cfg = loadConfig({ ...base, OTP_TEMPLATE: 'Vel#Chat' });
    expect(cfg.OTP_TEMPLATE).toBe('Vel#Chat');
  });
});
