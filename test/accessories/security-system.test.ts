import { defenceModeToState, targetStateToDefenceMode } from '../../src/accessories/security-system';
import { DefenceMode } from '../../src/utils/enums';

/**
 * These two pure mapping functions are the entire contract between HomeKit's
 * SecuritySystem states and EZVIZ's defence modes. A previous version of
 * targetStateToDefenceMode sent UNSET_MODE for DISARM, which does not actually
 * disarm the device on real hardware (EZVIZ reports it as "Armado", same as
 * Away/Night) — these tests pin the corrected mapping down.
 */
describe('defenceModeToState', () => {
  test('HOME_MODE maps to STAY_ARM (0)', () => {
    expect(defenceModeToState(DefenceMode.HOME_MODE)).toBe(0);
  });

  test('AWAY_MODE maps to AWAY_ARM (1)', () => {
    expect(defenceModeToState(DefenceMode.AWAY_MODE)).toBe(1);
  });

  test('SLEEP_MODE maps to NIGHT_ARM (2)', () => {
    expect(defenceModeToState(DefenceMode.SLEEP_MODE)).toBe(2);
  });

  test('UNSET_MODE maps to DISARMED (3)', () => {
    expect(defenceModeToState(DefenceMode.UNSET_MODE)).toBe(3);
  });

  test('an unrecognized mode falls back to DISARMED (3)', () => {
    expect(defenceModeToState(99 as DefenceMode)).toBe(3);
  });
});

describe('targetStateToDefenceMode', () => {
  test('AWAY_ARM (1) maps to AWAY_MODE', () => {
    expect(targetStateToDefenceMode(1)).toBe(DefenceMode.AWAY_MODE);
  });

  test('NIGHT_ARM (2) maps to SLEEP_MODE', () => {
    expect(targetStateToDefenceMode(2)).toBe(DefenceMode.SLEEP_MODE);
  });

  test('STAY_ARM (0) maps to HOME_MODE, the only mode that actually disarms', () => {
    expect(targetStateToDefenceMode(0)).toBe(DefenceMode.HOME_MODE);
  });

  test('DISARM (3) maps to HOME_MODE, not UNSET_MODE', () => {
    expect(targetStateToDefenceMode(3)).toBe(DefenceMode.HOME_MODE);
  });

  test('an unrecognized state falls back to HOME_MODE', () => {
    expect(targetStateToDefenceMode(99)).toBe(DefenceMode.HOME_MODE);
  });
});
