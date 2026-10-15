import { H264Level, H264Profile } from 'homebridge';

/** libx264 `-profile:v` value for the H264 profile HomeKit selected. */
export function h264ProfileName(profile: H264Profile): string {
  return profile === H264Profile.HIGH ? 'high'
    : profile === H264Profile.MAIN ? 'main' : 'baseline';
}

/** libx264 `-level:v` value for the H264 level HomeKit selected. */
export function h264LevelName(level: H264Level): string {
  return level === H264Level.LEVEL4_0 ? '4.0'
    : level === H264Level.LEVEL3_2 ? '3.2' : '3.1';
}
