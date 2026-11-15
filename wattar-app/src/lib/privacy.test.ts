import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRIVACY_SETTINGS,
  PRIVACY_ACTIONS,
  PRIVACY_DESCRIPTIONS,
  PRIVACY_LABELS,
  PRIVACY_LEVELS,
  asPrivacyLevel,
  toPrivacySettings,
} from './privacy';

const KEYS = [
  'can_follow',
  'can_message',
  'can_friend_request',
  'can_view_stories',
  'can_view_info',
  'can_enter_rooms',
] as const;

describe('privacy levels', () => {
  it('has exactly three levels matching the database CHECK constraint', () => {
    expect(PRIVACY_LEVELS).toEqual(['public', 'friends', 'none']);
  });

  it('labels and describes every level', () => {
    for (const level of PRIVACY_LEVELS) {
      expect(PRIVACY_LABELS[level].length).toBeGreaterThan(0);
      expect(PRIVACY_DESCRIPTIONS[level].length).toBeGreaterThan(0);
    }
  });

  it('defaults to public for every control', () => {
    expect(Object.values(DEFAULT_PRIVACY_SETTINGS).every((value) => value === 'public')).toBe(true);
    expect(Object.keys(DEFAULT_PRIVACY_SETTINGS).sort()).toEqual([...KEYS].sort());
  });

  it('exposes a UI row for every control exactly once', () => {
    const keys = PRIVACY_ACTIONS.map((action) => action.key).sort();
    expect(keys).toEqual([...KEYS].sort());
    for (const action of PRIVACY_ACTIONS) {
      expect(action.label.length).toBeGreaterThan(0);
      expect(action.description.length).toBeGreaterThan(0);
    }
  });
});

describe('asPrivacyLevel', () => {
  it('keeps known values', () => {
    expect(asPrivacyLevel('public')).toBe('public');
    expect(asPrivacyLevel('friends')).toBe('friends');
    expect(asPrivacyLevel('none')).toBe('none');
  });

  it('falls back for unknown values instead of trusting the server blindly', () => {
    expect(asPrivacyLevel('everyone')).toBe('public');
    expect(asPrivacyLevel('')).toBe('public');
    expect(asPrivacyLevel(null)).toBe('public');
    expect(asPrivacyLevel(undefined)).toBe('public');
    expect(asPrivacyLevel(3)).toBe('public');
    expect(asPrivacyLevel({ level: 'none' })).toBe('public');
  });

  it('honours a custom fallback', () => {
    expect(asPrivacyLevel('weird', 'friends')).toBe('friends');
  });
});

describe('toPrivacySettings', () => {
  it('returns defaults when the server returns null', () => {
    expect(toPrivacySettings(null)).toEqual(DEFAULT_PRIVACY_SETTINGS);
  });

  it('returns defaults for an empty object', () => {
    expect(toPrivacySettings({})).toEqual(DEFAULT_PRIVACY_SETTINGS);
  });

  it('maps a full server payload', () => {
    const payload = {
      can_follow: 'friends',
      can_message: 'none',
      can_friend_request: 'friends',
      can_view_stories: 'none',
      can_view_info: 'friends',
      can_enter_rooms: 'public',
    };
    expect(toPrivacySettings(payload)).toEqual(payload);
  });

  it('repairs invalid fields individually and keeps the valid ones', () => {
    const settings = toPrivacySettings({
      can_follow: 'friends',
      can_message: 'strangers',
      can_friend_request: null,
      can_view_stories: 'none',
    });
    expect(settings.can_follow).toBe('friends');
    expect(settings.can_view_stories).toBe('none');
    expect(settings.can_message).toBe('public');
    expect(settings.can_friend_request).toBe('public');
    expect(settings.can_view_info).toBe('public');
    expect(settings.can_enter_rooms).toBe('public');
  });

  it('ignores unknown extra keys', () => {
    const settings = toPrivacySettings({ can_follow: 'none', extra_flag: true });
    expect(Object.keys(settings).sort()).toEqual([...KEYS].sort());
    expect(settings.can_follow).toBe('none');
  });
});
