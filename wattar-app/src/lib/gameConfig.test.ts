import { describe, expect, it } from 'vitest';
import {
  aviatorWinProbability,
  binomialCoefficient,
  binomialProbability,
  clampBet,
  DEFAULT_PLINKO_TABLE,
  DEFAULT_SLOTS_TIERS,
  DEFAULT_WHEEL_SEGMENTS,
  diceQuote,
  gameUnavailableLabel,
  isIdempotencyKeyValid,
  newIdempotencyKey,
  parsePublicGames,
  plinkoRtp,
  slotsRtp,
  toPlinkoTable,
  toSlotsConfig,
  toWheelSegments,
  wheelRtp,
} from './gameConfig';

describe('الاحتمالات المعلنة (M9.4)', () => {
  it('RTP العجلة = متوسط عائد الخانات = 29.95%', () => {
    expect(wheelRtp(DEFAULT_WHEEL_SEGMENTS)).toBeCloseTo(29.95, 2);
  });

  it('RTP بلانغو (12 صفاً) = 29.37%', () => {
    expect(plinkoRtp(12, DEFAULT_PLINKO_TABLE.multipliers)).toBeCloseTo(29.37, 2);
  });

  it('RTP Slots = Σ احتمال × مضاعف = 30%', () => {
    expect(slotsRtp(DEFAULT_SLOTS_TIERS)).toBeCloseTo(30, 2);
  });

  it('توزيع بلانغو الثنائي مجموعه 1 وC(12,6)=924', () => {
    let total = 0;
    for (let k = 0; k <= 12; k += 1) total += binomialProbability(12, k);
    expect(total).toBeCloseTo(1, 10);
    expect(binomialCoefficient(12, 6)).toBe(924);
    expect(binomialProbability(12, 6)).toBeCloseTo(924 / 4096, 12);
  });

  it('احتمال صفر لخانة خارج النطاق', () => {
    expect(binomialProbability(12, -1)).toBe(0);
    expect(binomialProbability(12, 13)).toBe(0);
  });

  it('تسعير النرد لا يتجاوز RTP المعلن ولا يقل عنه بأكثر من خانة تقريب', () => {
    for (const target of [5, 25, 50, 75, 95]) {
      for (const direction of ['over', 'under'] as const) {
        const { pWin, multiplier } = diceQuote(target, direction, 30);
        expect(multiplier).toBe(Math.floor((1 / Math.max(pWin, 0.01)) * 0.3 * 100) / 100);
        const effectiveRtp = pWin * multiplier * 100;
        expect(effectiveRtp).toBeLessThanOrEqual(30 + 1e-9);
        expect(effectiveRtp).toBeGreaterThanOrEqual(30 - pWin - 1e-9);
      }
    }
  });

  it('احتمال الطيارة يحقق RTP المعلن عند أي مضاعف سحب', () => {
    for (const cashout of [1.2, 1.5, 2, 3, 10, 50]) {
      expect(aviatorWinProbability(cashout, 25) * cashout * 100).toBeCloseTo(25, 6);
    }
  });
});

describe('تحويل إعدادات الخادم', () => {
  it('يقرأ خانات العجلة من الإعدادات', () => {
    const segments = toWheelSegments({
      segments: [
        { value: 2, probability: 0.5, color: '#111111', label: 'x2' },
        { value: 0.5, probability: 0.5, color: '#222222', label: 'x0.5' },
      ],
    });
    expect(segments).toHaveLength(2);
    expect(wheelRtp(segments)).toBeCloseTo(62.5, 2);
  });

  it('يعود للافتراضي عند إعدادات عجلة غير صالحة', () => {
    expect(toWheelSegments({ segments: [{ value: 2 }] })).toEqual(DEFAULT_WHEEL_SEGMENTS);
    expect(toWheelSegments({})).toEqual(DEFAULT_WHEEL_SEGMENTS);
  });

  it('يعود لجدول بلانغو الافتراضي عند طول غير مطابق', () => {
    const table = toPlinkoTable({ rows: 12, multipliers: { medium: [1, 2, 3] } }, 'medium');
    expect(table.multipliers).toEqual(DEFAULT_PLINKO_TABLE.multipliers);
    expect(table.rows).toBe(12);
  });

  it('يقرأ جدول Slots ورموز الخسارة', () => {
    const config = toSlotsConfig({
      tiers: [{ symbol: '🍒', multiplier: 3, probability: 0.1 }],
      loss_symbols: ['🍋', '🍀', '⭐', '🍇'],
    });
    expect(config.tiers).toEqual([{ symbol: '🍒', multiplier: 3, probability: 0.1 }]);
    expect(config.lossSymbols).toHaveLength(4);
  });

  it('يرفض الألعاب غير المعروفة ويرتب حسب sort_order', () => {
    const games = parsePublicGames([
      { game_type: 'unknown', display_name: 'x', available: true },
      { game_type: 'slots', display_name: 'Slots', sort_order: 50, available: true, min_bet: 100, max_bet: 1000 },
      { game_type: 'wheel', display_name: 'عجلة', sort_order: 10, available: false, unavailable_reason: 'region', min_bet: 100, max_bet: 1000 },
    ]);
    expect(games.map((game) => game.game_type)).toEqual(['wheel', 'slots']);
    expect(games[0].available).toBe(false);
    expect(gameUnavailableLabel(games[0].unavailable_reason)).toBe('غير متاحة في منطقتك');
  });

  it('يتعامل مع رد غير صالح بلا انفجار', () => {
    expect(parsePublicGames(null)).toEqual([]);
    expect(parsePublicGames({})).toEqual([]);
  });
});

describe('منع الازدواج والتحقق من الرهان', () => {
  it('مفاتيح منع التكرار فريدة وصالحة دائماً', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i += 1) {
      const key = newIdempotencyKey('game-wheel');
      expect(isIdempotencyKeyValid(key)).toBe(true);
      seen.add(key);
    }
    expect(seen.size).toBe(5000);
  });

  it('ينظف بادئة المفتاح من الأحرف غير المسموحة', () => {
    const key = newIdempotencyKey('عجلة الحظ/جولة');
    expect(isIdempotencyKeyValid(key)).toBe(true);
  });

  it('حدود الرهان تحترم الإعدادات والرصيد', () => {
    expect(clampBet(100, 100, 1000, 500)).toBe(100);
    expect(clampBet(99, 100, 1000, 500)).toBeNull();
    expect(clampBet(600, 100, 1000, 500)).toBeNull();
    expect(clampBet(500, 100, 1000, 500)).toBe(500);
    expect(clampBet(1.5, 1, 10, 10)).toBeNull();
  });
});
