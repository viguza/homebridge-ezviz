import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { EZVIZPlatform } from '../platform.js';
import { EZVIZAPI } from '../api/ezviz-api.js';
import { SwitchTypes } from '../utils/enums.js';

const STATE_REFRESH_INTERVAL_MS = 60_000;

/**
 * Smart Plug accessory for EZVIZ devices
 * Handles on/off functionality for smart plugs
 */
export class SmartPlug {
  private api: EZVIZAPI;
  private readonly plugService: Service;
  private currentState = false;
  private reachable = true;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    api: EZVIZAPI,
    private readonly platform: EZVIZPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.api = api;

    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'EZVIZ')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.DeviceInfo.deviceSubCategory)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.device.Serial);
    
    // Set up the switch service
    this.plugService = this.accessory.getService(this.platform.Service.Switch) || 
                       this.accessory.addService(this.platform.Service.Switch);
    
    this.plugService.setCharacteristic(this.platform.Characteristic.Name, this.accessory.context.device.Name);
    
    // Set up event handlers. The read answers from cached state so it never waits on
    // the network — HomeKit abandons a read that takes longer than 9s.
    this.plugService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOnState.bind(this))
      .onGet(this.getOnState.bind(this));

    this.refreshState();
    this.refreshTimer = setInterval(() => this.refreshState(), STATE_REFRESH_INTERVAL_MS);
  }

  /**
   * Sets the on/off state of the smart plug
   * @param value - The value to set (true for on, false for off)
   */
  async setOnState(value: CharacteristicValue) {
    try {
      const action = value ? true : false;
      await this.api.setSwitchState(this.accessory.context.device.Serial, SwitchTypes.On, action);
      this.currentState = action;
      this.reachable = true;
      this.platform.log.debug(`Successfully set ${this.accessory.context.device.Name} to ${action ? 'ON' : 'OFF'}`);
    } catch (error) {
      this.platform.log.error(`Unable to set switch state for ${this.accessory.context.device.Name}:`, error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Returns the last known on/off state without blocking on the network.
   * Reports a communication failure when the most recent refresh could not reach
   * the device, so HomeKit shows "No Response" instead of a stale value.
   */
  getOnState(): CharacteristicValue {
    if (!this.reachable) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return this.currentState;
  }

  /**
   * Refreshes the cached state in the background and pushes any change to HomeKit
   */
  private async refreshState(): Promise<void> {
    try {
      const state = await this.api.getSwitchState(this.accessory.context.device.Serial, SwitchTypes.On);
      this.reachable = true;

      if (state !== this.currentState) {
        this.currentState = state;
        this.plugService.updateCharacteristic(this.platform.Characteristic.On, state);
        this.platform.log.debug(`${this.accessory.context.device.Name} is now ${state ? 'ON' : 'OFF'}`);
      }
    } catch (error) {
      this.reachable = false;
      this.platform.log.error(
        `${this.accessory.context.device.Name} (${this.accessory.context.device.Serial}) seems to be unreachable:`,
        error,
      );
    }
  }

  /**
   * Stops the background state refresh
   */
  stopPolling(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Gets the accessory instance
   * @returns The platform accessory
   */
  getAccessory() {
    return this.accessory;
  }
}
