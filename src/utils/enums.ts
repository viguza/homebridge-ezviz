export enum DeviceTypes {
  IPC = 'Camera',
  Socket = 'Plug',
  CatEye = 'Peephole',
}

export enum SwitchTypes {
  AlarmTone = 1,
  StreamAdaptive = 2,
  Light = 3,
  IntelligentAnalysis = 4,
  Privacy = 7,
  InfraredLight = 10,
  Plug = 14,
  Sleep = 21,
  Audio = 22,
  MobileTracking = 25,
  AllDayVideo = 29,
  AutoSleep = 32,
  AlarmRemindMode = 37,
  AlarmLight = 303,
  AlarmLightRelevance = 305,
  TamperAlarm = 306,
  WideAngle = 604,
  DistortionCorrection = 617,
  Tracking = 650,
  FeatureTracking = 701,
}

export enum DefenceMode {
  UNSET_MODE = 0,
  HOME_MODE = 1,
  AWAY_MODE = 2,
  SLEEP_MODE = 3,
}
