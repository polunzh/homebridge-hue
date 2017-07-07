// homebridge-hue/lib/HueSensor.js
// Copyright © 2016, 2017 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Philips Hue.
//
// HueSensor provides support for Philips Hue sensors.

'use strict';

const util = require('util');

// Link this module to HuePlatform.
module.exports = {
  setHomebridge: setHomebridge,
  HueSensor: HueSensor
};

// ===== Homebridge ============================================================

// Link this module to homebridge.
let Accessory;
let Service;
let Characteristic;

function setHomebridge(homebridge) {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
}

function hkLightLevel(v) {
  let l = v ? Math.pow(10, (v - 1) / 10000) : 0.0001;
  l = Math.round(l * 10000) / 10000;
  return l > 100000 ? 100000 : l < 0.0001 ? 0.0001 : l;
}

// As homebridge-hue polls the Hue bridge, not all dimmer switch buttonevents
// are received reliably.  Consequently, we only issue one HomeKit change per
// Press/Hold/Release event series.
function hkZLLSwitchAction(value, oldValue) {
  const button = Math.floor(value / 1000);
  const oldButton = Math.floor(oldValue / 1000);
  const event = value % 1000;
  const oldEvent = oldValue % 1000;
  switch (event) {
    case 0:   // Press
      return undefined;         // Wait for Hold or Release after press.
    case 2:   // Release after press
      return Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS;
    case 1:   // Hold
    case 3:   // Release after hold
      if (button === oldButton && oldEvent === 1) {
        // Already issued action on previous Hold.
        return undefined;
      }
      return Characteristic.ProgrammableSwitchEvent.LONG_PRESS;
  }
}

// ===== HueSensor =============================================================

function HueSensor(bridge, id, obj) {
  // jshint -W106
  this.log = bridge.log;
  this.bridge = bridge;
  this.name = obj.name;
  this.obj = obj;
  this.resource = '/sensors/' + id;

  if (this.obj.type[0] === 'Z') {
    // Zigbee sensor.
    this.manufacturer = this.obj.manufacturername;
    this.model = this.obj.modelid;
    this.uuid_base = this.obj.uniqueid.split('-')[0];
  } else {
    // Hue bridge internal sensor.
    this.manufacturer = 'Philips';
    this.model = this.obj.type;
    this.uuid_base = this.bridge.uuid_base + this.resource;
  }
  this.infoService = new Service.AccessoryInformation();
  this.serviceList = [this.infoService];

  // See: http://www.developers.meethue.com/documentation/supported-sensors
  let buttonIndex;
  switch(this.obj.type) {
    case 'ZGPSwitch':   // 1.1 - Hue Tap
      if (this.obj.manufacturername !== 'Philips' ||
          this.obj.modelid !== 'ZGPSWITCH') {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        );
        break;
      }
      this.createButton(1, '1');
      this.createButton(2, '2');
      this.createButton(3, '3');
      this.createButton(4, '4');
      this.service = new Service.Resource(this.name);
      this.type = {
        key:            'buttonevent',
        homekitValue:   function(v) {return {34: 1, 16: 2, 17: 3, 18: 4}[v];},
        homekitAction:  function() {return 0;}
      };
      break;
    case 'ZLLSwitch': 	// 1.2 - Hue Wireless Dimmer Switch
    case 'ZHASwitch':
      let buttons;
      if (
        this.obj.manufacturername === 'Philips' &&
        (this.obj.modelid === 'RWL021' || this.obj.modelid === 'RWL020')
      ) {
        this.createButton(1, 'On', true);
        this.createButton(2, 'Dim Up', true);
        this.createButton(3, 'Dim Down', true);
        this.createButton(4, 'Off', true);
      } else if (
        this.obj.manufacturername === 'IKEA of Sweden' &&
        this.obj.modelid === 'TRADFRI remote control'
      ) {
        this.createButton(1, 'On/Off');
        this.createButton(2, 'Dim Up', true);
        this.createButton(3, 'Dim Down', true);
        this.createButton(4, 'Previous');
        this.createButton(5, 'Next');
      } else {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        );
        break;
      }
      this.service = new Service.Resource(this.name);
      this.type = {
        key:            'buttonevent',
        homekitValue:   function(v) {return Math.floor(v / 1000);},
        homekitAction:  hkZLLSwitchAction
      };
      break;
    case 'ZLLPresence':	// 1.3 - Hue Motion Sensor
    case 'ZHAPresence':
      if (this.obj.manufacturername !== 'Philips' ||
          this.obj.modelid !== 'SML001') {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        );
      }
      this.service = new Service.MotionSensor(this.name);
      this.type = {
        Characteristic: Characteristic.MotionDetected,
        key:		        'presence',
        name:		        'motion',
        unit:		        '',
        homekitValue:   function(v) {return v ? 1 : 0;}
      };
      break;
    case 'ZLLTemperature': // 1.4 - Hue Motion Sensor
    case 'ZHATemperature':
      if (this.obj.manufacturername !== 'Philips' ||
          this.obj.modelid !== 'SML001') {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        );
      }
      /* falls through */
    case 'CLIPTemperature': // 2.4
      this.service = new Service.TemperatureSensor(this.name);
      this.type = {
        Characteristic:	Characteristic.CurrentTemperature,
        props:          { minValue: -273.2, maxValue: 1000.0 },
        key:		        'temperature',
        name:		        'temperature',
        unit:		        '˚C',
        homekitValue:   function(v) {return v ? Math.round(v / 10) / 10 : 0;}
      };
      break;
    case 'ZLLLightLevel': // 2.7 - Hue Motion Sensor
    case 'ZHALight':
      if (this.obj.manufacturername !== 'Philips' ||
          this.obj.modelid !== 'SML001') {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        );
      }
      /* falls through */
    case 'CLIPLightLevel': // 2.7
      this.service = new Service.LightSensor(this.name);
      this.type = {
        Characteristic:	Characteristic.CurrentAmbientLightLevel,
        key:		        'lightlevel',
        name:		        'light level',
        unit:		        ' lux',
        homekitValue:   hkLightLevel
      };
      break;
    case 'CLIPOpenClose': // 2.2
      this.service = new Service.ContactSensor(this.name);
      this.type = {
        Characteristic:	Characteristic.ContactSensorState,
        key:		        'open',
        name:		        'contact',
        unit:		        '',
        homekitValue:   function(v) {return v ? 0 : 1;}
      };
      break;
    case 'CLIPPresence': // 2.3
    case 'Geofence':    // Undocumented
      this.service = new Service.OccupancySensor(this.name);
      this.type = {
        Characteristic:	Characteristic.OccupancyDetected,
        key:		        'presence',
        name:		        'occupancy',
        unit:		        '',
        homekitValue:   function(v) {return v ? 1 : 0;}
      };
      break;
    case 'CLIPHumidity': // 2.5
      this.service = new Service.HumiditySensor(this.name);
      this.type = {
        Characteristic:	Characteristic.CurrentRelativeHumidity,
        key:		        'humidity',
        name:		        'humidity',
        unit:		        '%',
        homekitValue:   function(v) {return v ? Math.round(v / 100) : 0;}
      };
      break;
    case 'Daylight': // 2.6 - Built-in daylight sensor.
      if (this.obj.manufacturername !== 'Philips' ||
          this.obj.modelid !== 'PHDL00') {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        );
      }
      this.manufacturer = this.obj.manufacturername;
      this.model = this.obj.modelid;
      this.service = new Service.LightSensor(this.name);
      this.type = {
        Characteristic: Characteristic.CurrentAmbientLightLevel,
        key:		        'daylight',
        name:		        'light level',
        unit:		        ' lux',
        homekitValue:   function(v) {return v ? 100000.0 : 0.0001;}
      };
      break;
    case 'CLIPGenericFlag':	// 2.8
      this.service = new Service.Switch(this.name);
      this.type = {
        Characteristic:	Characteristic.On,
        key:		        'flag',
        name:		        'power',
        unit:		        '',
        homekitValue:   function(v) {return v ? 1 : 0;},
        bridgeValue:    function(v) {return v ? true : false;},
        setter:         true
      };
      break;
    case 'CLIPGenericStatus': // 2.9
      this.service = new Service.Status(this.name);
      this.type = {
        Characteristic:	Characteristic.Status,
        key:		        'status',
        name:		        'status',
        unit:		        '',
        homekitValue:   function(v) {return v > 255 ? 255 : v < 0 ? 0 : v;},
        bridgeValue:    function(v) {return v;},
        setter:         true
      };
      if (obj.modelid === 'PHCLGS' &&
          Number(obj.swversion) === parseInt(obj.swversion)) {
        const max = Number(obj.swversion);
        if (max > 0 && max <= 255) {
          // this.log.debug('%s: maxValue %j', this.name, max);
          this.type.props = {maxValue: max};
        }
      }
      break;
    case 'CLIPSwitch': // 2.1
      this.log.warn(
        '%s: %s: warning: ignoring unsupported sensor type %s',
        this.bridge.name, this.resource, this.obj.type
      );
      break;
    default:
      this.log.warn(
        '%s: %s: warning: ignoring unknown sensor type %j',
        this.bridge.name, this.resource, this.obj
      );
      break;
  }

  this.infoService
    .updateCharacteristic(Characteristic.Manufacturer, this.manufacturer)
    .updateCharacteristic(Characteristic.Model, this.model)
    .updateCharacteristic(Characteristic.SerialNumber, this.uuid_base);

  if (this.service) {
    this.refresh();
    this.serviceList.push(this.service);
    if (this.type.Characteristic) {
      const char = this.service.getCharacteristic(this.type.Characteristic);
      if (this.type.props) {
        char.setProps(this.type.props);
      }
      char.updateValue(this.hk.value);
      if (this.type.setter) {
        char.on('set', this.setValue.bind(this));
      }
    }
    if (this.hk.dark !== undefined) {
      this.service.addOptionalCharacteristic(Characteristic.Dark);
      this.service.getCharacteristic(Characteristic.Dark)
        .updateValue(this.hk.dark);
    }
    if (this.hk.daylight !== undefined) {
      this.service.addOptionalCharacteristic(Characteristic.Daylight);
      this.service.getCharacteristic(Characteristic.Daylight)
        .updateValue(this.hk.daylight);
    }
    this.service.addOptionalCharacteristic(Characteristic.LastUpdated);
    this.service.getCharacteristic(Characteristic.LastUpdated)
      .updateValue(this.hk.lastupdated);
    this.service.addOptionalCharacteristic(Characteristic.Enabled);
    this.service.getCharacteristic(Characteristic.Enabled)
      .updateValue(this.hk.enabled)
      .on('set', this.setEnabled.bind(this));
    this.service.addOptionalCharacteristic(Characteristic.StatusActive);
    this.service.getCharacteristic(Characteristic.StatusActive)
      .updateValue(this.hk.enabled);
    if (this.obj.config.reachable !== undefined) {
      this.service.addOptionalCharacteristic(Characteristic.StatusFault);
      this.service.getCharacteristic(Characteristic.StatusFault)
        .updateValue(this.hk.fault);
    }
    if (this.hk.sensitivity !== undefined) {
      this.service.addOptionalCharacteristic(Characteristic.Sensitivity);
      this.service.getCharacteristic(Characteristic.Sensitivity)
        .updateValue(this.hk.sensitivity)
        .on('set', this.setSensitivity.bind(this));
      this.service.addOptionalCharacteristic(Characteristic.Duration);
      this.duration = 0;
      this.hk.duration = 0;
      this.service.getCharacteristic(Characteristic.Duration)
        .updateValue(this.hk.duration)
        .on('set', this.setDuration.bind(this));
    }
    if (this.bridge.platform.config.resource) {
      this.service.addOptionalCharacteristic(Characteristic.Resource);
      this.service.getCharacteristic(Characteristic.Resource)
        .updateValue(this.resource);
    }
    if (this.obj.config.battery) {
      this.batteryService = new Service.BatteryService(this.name);
      this.batteryService
        .updateCharacteristic(Characteristic.BatteryLevel, this.hk.battery)
        .updateCharacteristic(Characteristic.StatusLowBattery, this.hk.lowBattery)
        .updateCharacteristic(Characteristic.ChargingState, this.hk.charging);
    }
  }
}

HueSensor.prototype.getServices = function() {
  if (this.batteryService) {
    this.serviceList.push(this.batteryService);
  }
  return this.serviceList;
};

HueSensor.prototype.createButton = function(
  buttonIndex, buttonName, longPress
) {
  const service = new Service.StatelessProgrammableSwitch(
    this.name + ' ' + buttonName, buttonName
  );
  this.serviceList.push(service);
  let props = {
    minValue: Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
  };
  if (longPress) {
    props.maxValue = Characteristic.ProgrammableSwitchEvent.LONG_PRESS;
    props.validValues = [
      Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
      Characteristic.ProgrammableSwitchEvent.LONG_PRESS
    ];
  } else {
    props.maxValue = Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS;
  }
  service.getCharacteristic(Characteristic.ProgrammableSwitchEvent)
    .setProps(props);
  service.getCharacteristic(Characteristic.LabelIndex)
    .setValue(buttonIndex);
};

// Translate bridge values to homekit values.
HueSensor.prototype.refresh = function() {
  this.value = this.obj.state[this.type.key];
  this.hk = {};
  this.hk.value = this.type.homekitValue(this.value);
  if (this.obj.state.dark !== undefined) {
    this.hk.dark = this.obj.state.dark ? 1 : 0;
  }
  if (this.obj.state.daylight !== undefined) {
    this.hk.daylight = this.obj.state.daylight ? 1 : 0;
  }
  this.hk.lastupdated = this.obj.state.lastupdated === 'none' ?
    'n/a' : String(new Date(this.obj.state.lastupdated)).substring(0, 24);
  this.hk.enabled = this.obj.config.on ? 1 : 0;
  this.hk.fault = this.obj.config.reachable ? 0 : 1;
  if (this.obj.config.sensitivity !== undefined) {
    this.hk.sensitivity = this.obj.config.sensitivity;
    this.hk.duration = this.duration / 60000;
  }
  this.hk.battery = this.obj.config.battery ? this.obj.config.battery : 100;
  this.hk.lowBattery =
    this.hk.battery <= this.bridge.platform.config.lowBattery ?
    Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW :
    Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
  this.hk.charging = Characteristic.ChargingState.NOT_CHARGEABLE;
};

// ===== Bridge Events =========================================================

HueSensor.prototype.heartbeat = function(obj) {
  if (!this.service) {
    return;
  }
  const old = {
    obj: this.obj,
    value: this.value,
    hk: this.hk
  };
  this.obj = obj;
  this.refresh();
  if (this.type.key === 'buttonevent') {
    if (this.obj.state.lastupdated !== old.obj.state.lastupdated) {
      this.log.debug(
        '%s: sensor buttonevent %d on %s', this.name,
      	this.value, this.obj.state.lastupdated
      );
      const action = this.type.homekitAction(this.value, old.value);
      if (this.hk.value !== 0 && action !== undefined) {
        this.log.info(
          '%s: homekit button %s', this.serviceList[this.hk.value].displayName,
          {0: 'single press', 1: 'double press', 2: 'long press'}[action]
        );
        this.serviceList[this.hk.value]
          .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
          .updateValue(action);
      }
    }
  } else {
    if (this.value !== old.value) {
      this.log.debug(
        '%s: sensor %s changed from %s to %s on %s', this.name,
      	this.type.key, old.value, this.value, this.obj.state.lastupdated
      );
    }
    if (this.hk.value !== old.hk.value) {
      if (this.durationTimer) {
        clearTimeout(this.durationTimer);
        this.durationTimer = null;
      }
      if (this.duration > 0  && this.hk.value === 0) {
        this.log.debug(
          '%s: keep homekit %s on %s%s for %dm on %s', this.name,
          this.type.name, old.hk.value, this.type.unit, this.hk.duration,
          this.hk.lastupdated
        );
        const saved = {
          oldValue: old.hk.value,
          value: this.hk.value,
          duration: this.hk.duration,
          lastupdated: this.hk.lastupdated
        };
        this.durationTimer = setTimeout(function () {
          this.log.info(
            '%s: set homekit %s from %s%s to %s%s, %dm after %s',
            this.name, this.type.name, saved.oldValue, this.type.unit,
          	saved.value, this.type.unit, saved.duration, saved.lastupdated
          );
          this.durationTimer = null;
          this.service
            .updateCharacteristic(this.type.Characteristic, saved.value);
        }.bind(this), this.duration);
      } else {
        this.log.info(
          '%s: set homekit %s from %s%s to %s%s on %s', this.name,
        	this.type.name, old.hk.value, this.type.unit,
        	this.hk.value, this.type.unit, this.hk.lastupdated
        );
        this.service
          .updateCharacteristic(this.type.Characteristic, this.hk.value);
        }
    }
  }
  if (this.obj.state.dark !== old.obj.state.dark) {
    this.log.debug(
      '%s: sensor dark changed from %s to %s', this.name,
      old.obj.state.dark, this.obj.state.dark
    );
  }
  if (this.hk.dark !== old.hk.dark) {
    this.log.info(
      '%s: set homekit dark from %s to %s', this.name,
      old.hk.dark, this.hk.dark
    );
    this.service.updateCharacteristic(Characteristic.Dark, this.hk.dark);
  }
  if (this.obj.state.daylight !== old.obj.state.daylight) {
    this.log.debug(
      '%s: sensor daylight changed from %s to %s', this.name,
      old.obj.state.daylight, this.obj.state.daylight
    );
  }
  if (this.hk.daylight !== old.hk.daylight) {
    this.log.info(
      '%s: set homekit daylight from %s to %s', this.name,
      old.hk.daylight, this.hk.daylight
    );
    this.service
      .updateCharacteristic(Characteristic.Daylight, this.hk.daylight);
  }
  if (this.obj.config.sensitivity !== old.obj.config.sensitivity) {
    this.log.debug(
      '%s: sensor sensitivity changed from %s to %s', this.name,
      old.obj.config.sensitivity, this.obj.config.sensitivity
    );
  }
  if (this.obj.state.lastupdated !== old.obj.state.lastupdated) {
    this.service
      .updateCharacteristic(Characteristic.LastUpdated, this.hk.lastupdated);
  }
  if (this.obj.config.on !== old.obj.config.on) {
    this.log.debug(
      '%s: sensor on changed from %s to %s', this.name,
      old.obj.config.on, this.obj.config.on
    );
  }
  if (this.hk.enabled !== old.hk.enabled) {
    this.log.info(
      '%s: set homekit enabled from %s to %s', this.name,
      old.hk.enabled, this.hk.enabled
    );
    this.service
      .updateCharacteristic(Characteristic.Enabled, this.hk.enabled)
      .updateCharacteristic(Characteristic.StatusActive, this.hk.enabled);
  }
  if (
    this.obj.config.reachable !== undefined &&
    this.obj.config.reachable !== old.obj.config.reachable
  ) {
    this.log.debug(
      '%s: sensor reachable changed from %s to %s', this.name,
      old.obj.config.reachable, this.obj.config.reachable
    );
  }
  if (this.hk.fault !== old.hk.fault) {
    this.log.info(
      '%s: set homekit status fault from %s to %s', this.name,
      old.hk.fault, this.hk.fault
    );
    this.service
      .updateCharacteristic(Characteristic.StatusFault, this.hk.fault);
  }
  if (this.hk.sensitivity !== old.hk.sensitivity) {
    this.log.info(
      '%s: set homekit sensitivity from %s to %s', this.name,
      old.hk.sensitivity, this.hk.sensitivity
    );
    this.service
      .updateCharacteristic(Characteristic.Sensitivity, this.hk.sensitivity);
  }
  if (
    this.obj.config.battery !== undefined &&
    this.obj.config.battery != old.obj.config.battery
  ) {
    this.log.debug(
      '%s: sensor battery changed from %s to %s', this.name,
      old.obj.config.battery, this.obj.config.battery);
  }
  if (this.hk.battery !== old.hk.battery) {
    this.log.info(
      '%s: set homekit battery level from %s%% to %s%%', this.name,
      old.hk.battery, this.hk.battery
    );
    this.batteryService
      .updateCharacteristic(Characteristic.BatteryLevel, this.hk.battery)
      .updateCharacteristic(
        Characteristic.StatusLowBattery, this.hk.lowBattery
      );
  }
};

// ===== Homekit Events ========================================================

HueSensor.prototype.identify = function(callback) {
  this.log.info('%s: identify', this.name);
  if (this.obj.config.alert === undefined) {
    return callback();
  }
  this.bridge.request('put', this.resource + '/config', {alert: 'select'})
  .then(function(obj) {
    return callback();
  }.bind(this))
  .catch(function(err) {
    return callback(new Error(err));
  }.bind(this));
};

HueSensor.prototype.setValue = function(value, callback) {
  if (value === this.hk.value) {
    return callback();
  }
  this.log.info(
    '%s: homekit %s changed from %s%s to %s%s', this.name,
    this.type.name,	this.hk.value, this.type.unit, value, this.type.unit
  );
  this.hk.value = value;
  const newValue = this.type.bridgeValue(value);
  const body = {};
  body[this.type.key] = newValue;
  this.bridge.request('put', this.resource + '/state', body)
  .then(function(obj) {
    this.obj.state[this.type.key] = newValue;
    this.value = newValue;
    return callback();
  }.bind(this))
  .catch(function(err) {
    return callback(new Error(err));
  }.bind(this));
};

HueSensor.prototype.setEnabled = function(enabled, callback) {
  enabled = enabled ? 1 : 0;
  if (enabled === this.hk.enabled) {
    return callback();
  }
  this.log.info(
    '%s: homekit enabled changed from %s to %s', this.name,
  	this.hk.enabled, enabled
  );
  this.hk.enabled = enabled;
  const on = this.hk.enabled ? true : false;
  this.bridge.request('put', this.resource + '/config', {on: on})
  .then(function(obj) {
    this.obj.config.on = on;
    this.service
      .updateCharacteristic(Characteristic.StatusActive, this.hk.enabled);
    return callback();
  }.bind(this))
  .catch(function(err) {
    return callback(new Error(err));
  }.bind(this));
};

HueSensor.prototype.setSensitivity = function(sensitivity, callback) {
  if (sensitivity === this.hk.sensitivity) {
    return callback();
  }
  this.log.info(
    '%s: homekit sensitivity changed from %s to %s', this.name,
  	this.hk.sensitivity, sensitivity
  );
  this.hk.sensitivity = sensitivity;
  this.bridge.request(
    'put', this.resource + '/config', {sensitivity: sensitivity}
  )
  .then(function(obj) {
    this.obj.config.sensitivity = sensitivity;
    return callback();
  }.bind(this))
  .catch(function(err) {
    return callback(new Error(err));
  }.bind(this));
};

HueSensor.prototype.setDuration = function(duration, callback) {
  if (duration === this.hk.duration) {
    return callback();
  }
  this.log.info(
    '%s: homekit duration changed from %sm to %sm', this.name,
  	this.hk.duration, duration
  );
  this.hk.duration = duration;
  this.duration = duration * 60000;
  return callback();
};
