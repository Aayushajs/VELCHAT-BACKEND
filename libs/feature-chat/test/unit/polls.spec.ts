import { isPollClosed, shapeResults, type PollDoc } from '../../src/polls/polls.logic';

const NOW = new Date('2026-07-04T12:00:00.000Z');

const poll = (over: Partial<PollDoc> = {}): PollDoc => ({
  _id: 'm1',
  conversation_id: 'c1',
  options: [
    { id: 'o1', text: 'Yes' },
    { id: 'o2', text: 'No' },
  ],
  multi: false,
  anonymous: false,
  closes_at: null,
  created_by: 'u1',
  created_at: NOW.toISOString(),
  ...over,
});

describe('isPollClosed', () => {
  it('open when no close time / future close time', () => {
    expect(isPollClosed(null, NOW)).toBe(false);
    expect(isPollClosed('2026-07-04T13:00:00.000Z', NOW)).toBe(false);
  });
  it('closed when close time is in the past', () => {
    expect(isPollClosed('2026-07-04T11:00:00.000Z', NOW)).toBe(true);
  });
});

describe('shapeResults', () => {
  const counts = { o1: 2, o2: 1 };
  const voters = { o1: ['u1', 'u2'], o2: ['u3'] };

  it('non-anonymous → includes counts + voters, total summed', () => {
    const r = shapeResults(poll(), counts, voters, NOW);
    expect(r.total).toBe(3);
    expect(r.options[0]).toEqual({ id: 'o1', text: 'Yes', count: 2, voters: ['u1', 'u2'] });
    expect(r.anonymous).toBe(false);
  });

  it('anonymous → hides voters (counts still shown)', () => {
    const r = shapeResults(poll({ anonymous: true }), counts, voters, NOW);
    expect(r.options[0]).toEqual({ id: 'o1', text: 'Yes', count: 2 });
    expect(r.options[0]).not.toHaveProperty('voters');
  });

  it('anonymous + admin viewer → voters revealed', () => {
    const r = shapeResults(poll({ anonymous: true }), counts, voters, NOW, true);
    expect(r.options[0]).toHaveProperty('voters', ['u1', 'u2']);
  });

  it('option with no votes → count 0', () => {
    const r = shapeResults(poll(), { o1: 1 }, { o1: ['u1'] }, NOW);
    expect(r.options[1]).toMatchObject({ id: 'o2', count: 0 });
    expect(r.total).toBe(1);
  });
});
