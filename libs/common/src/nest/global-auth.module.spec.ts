import { Controller, Get, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard, Public } from './jwt-auth.guard';
import { HealthController, MetricsController } from './observability.module';
import { UnauthorizedError } from '../errors/errors';

/**
 * With a GLOBAL guard (DEF-02) the probe endpoints become the trap: if `/health` starts answering
 * 401, Docker marks the container unhealthy and restarts it forever. These tests pin the probes as
 * reachable without a token, and pin an ordinary route as NOT reachable — so the fix cannot
 * degrade into "everything is public".
 */
@Controller('demo')
class GuardedController {
  @Get()
  list(): string {
    return 'secret';
  }
}

@Controller('hook')
class PublicController {
  @Public()
  @Get()
  receive(): string {
    return 'ok';
  }
}

function contextFor(
  handler: (...args: never[]) => unknown,
  cls: new (...args: never[]) => unknown,
  headers: Record<string, string | undefined> = {},
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

const guard = () =>
  new JwtAuthGuard(new Reflector(), {
    publicKeyPem: '-----BEGIN PUBLIC KEY-----\nnot-used-for-public-routes',
    issuer: 'https://auth.velchat.local',
  });

describe('global guard — probe endpoints stay reachable', () => {
  it('allows /health without a token', () => {
    expect(
      guard().canActivate(contextFor(HealthController.prototype.health, HealthController)),
    ).toBe(true);
  });

  it('allows /ready without a token', () => {
    expect(
      guard().canActivate(contextFor(HealthController.prototype.ready, HealthController)),
    ).toBe(true);
  });

  it('allows /metrics without a token', () => {
    expect(
      guard().canActivate(contextFor(MetricsController.prototype.metrics, MetricsController)),
    ).toBe(true);
  });

  it('still rejects an ordinary route without a token', () => {
    expect(() =>
      guard().canActivate(contextFor(GuardedController.prototype.list, GuardedController)),
    ).toThrow(UnauthorizedError);
  });

  it('allows a route explicitly marked @Public()', () => {
    expect(
      guard().canActivate(contextFor(PublicController.prototype.receive, PublicController)),
    ).toBe(true);
  });
});
