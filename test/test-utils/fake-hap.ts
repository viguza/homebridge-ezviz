/**
 * A minimal fake HAP layer for driving accessory classes (SmartPlug, SecuritySystemAccessory,
 * MotionSensor) directly — capturing the onSet/onGet handlers they register so tests can
 * invoke them like HomeKit would, and recording updateCharacteristic pushes for assertions.
 */

export type FakeCharacteristic = {
  onSetHandler?: (value: unknown) => unknown;
  onGetHandler?: () => unknown;
  onSet(handler: (value: unknown) => unknown): FakeCharacteristic;
  onGet(handler: () => unknown): FakeCharacteristic;
};

export function makeFakeCharacteristic(): FakeCharacteristic {
  const characteristic: FakeCharacteristic = {
    onSet(handler) {
      characteristic.onSetHandler = handler;
      return characteristic;
    },
    onGet(handler) {
      characteristic.onGetHandler = handler;
      return characteristic;
    },
  };
  return characteristic;
}

export type FakeService = {
  name: string;
  updates: Array<[string, unknown]>;
  setCharacteristic(name: string, value: unknown): FakeService;
  getCharacteristic(name: string): FakeCharacteristic;
  updateCharacteristic(name: string, value: unknown): void;
};

export function makeFakeService(name: string): FakeService {
  const characteristics = new Map<string, FakeCharacteristic>();
  const service: FakeService = {
    name,
    updates: [],
    setCharacteristic() {
      return service;
    },
    getCharacteristic(charName) {
      if (!characteristics.has(charName)) {
        characteristics.set(charName, makeFakeCharacteristic());
      }
      return characteristics.get(charName)!;
    },
    updateCharacteristic(charName, value) {
      service.updates.push([charName, value]);
    },
  };
  return service;
}

export class FakeAccessory {
  context: Record<string, unknown> = {};
  private services = new Map<string, FakeService>();

  constructor(public displayName = 'Test Accessory') {
    this.services.set('AccessoryInformation', makeFakeService('AccessoryInformation'));
  }

  getService(name: string): FakeService | undefined {
    return this.services.get(name);
  }

  addService(name: string): FakeService {
    const service = makeFakeService(name);
    this.services.set(name, service);
    return service;
  }

  removeService(service: FakeService): void {
    this.services.delete(service.name);
  }
}

export class FakeHapStatusError extends Error {
  constructor(public status: number) {
    super(`HapStatusError: ${status}`);
  }
}

export function makeFakePlatform() {
  return {
    log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    Service: {
      AccessoryInformation: 'AccessoryInformation',
      Switch: 'Switch',
      SecuritySystem: 'SecuritySystem',
      MotionSensor: 'MotionSensor',
    },
    Characteristic: {
      Manufacturer: 'Manufacturer',
      Model: 'Model',
      SerialNumber: 'SerialNumber',
      Name: 'Name',
      On: 'On',
      MotionDetected: 'MotionDetected',
      SecuritySystemTargetState: 'SecuritySystemTargetState',
      SecuritySystemCurrentState: 'SecuritySystemCurrentState',
    },
    api: {
      hap: {
        HapStatusError: FakeHapStatusError,
        HAPStatus: { SERVICE_COMMUNICATION_FAILURE: -70402 },
      },
    },
  };
}
