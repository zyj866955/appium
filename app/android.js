"use strict";

var errors = require('./errors')
  , adb = require('../uiautomator/adb')
  , _ = require('underscore')
  , logger = require('../logger').get('appium')
  , deviceCommon = require('./device')
  , status = require("./uiauto/lib/status")
  , NotImplementedError = errors.NotImplementedError
  , UnknownError = errors.UnknownError;

var Android = function(opts) {
  this.rest = opts.rest;
  this.opts = opts;
  //this.apkPath = opts.apkPath;
  //this.appPackage = opts.appPackage;
  //this.appActivity = opts.appActivity;
  this.verbose = opts.verbose;
  this.queue = [];
  this.progress = 0;
  this.onStop = function() {};
  this.implicitWaitMs = 0;
  this.commandTimeoutMs = 60 * 1000;
  this.origCommandTimeoutMs = this.commandTimeoutMs;
  this.commandTimeout = null;
  this.adb = null;
  this.capabilities = {
    platform: 'LINUX'
    , browserName: 'Android'
    , version: '4.1'
    , webStorageEnabled: false
    , takesScreenshots: true
    , javascriptEnabled: true
    , databaseEnabled: false
  };
};

Android.prototype.start = function(cb, onDie) {
  if (typeof onDie === "function") {
    this.onStop = onDie;
  }
  var didLaunch = false;

  var onLaunch = _.bind(function(err) {
    if (err) {
      logger.error("ADB failed to launch!");
      this.adb = null;
      this.onStop = null;
      cb(err);
    } else {
      logger.info("ADB launched! Ready for commands (will time out in " +
                  (this.commandTimeoutMs / 1000) + "secs)");
      this.resetTimeout();
      didLaunch = true;
      cb(null);
    }
  }, this);

  var onExit = _.bind(function(code) {
    if (!didLaunch) {
      logger.error("ADB quit before it successfully launched");
      cb("ADB quit unexpectedly before successfully launching");
      code = code || 1;
    } else if (typeof this.cbForCurrentCmd === "function") {
      var error = new UnknownError("ADB died while responding to command, " +
                                   "please check appium logs!");
      this.cbForCurrentCmd(error, null);
      code = code || 1;
    }
    this.adb.uninstallApp(_.bind(function() {
      this.adb = null;
      this.onStop(code);
      this.onStop = null;
    }, this));
  }, this);

  if (this.adb === null) {
    this.adb = adb(this.opts);
    this.adb.start(onLaunch, onExit);
  } else {
    logger.error("Tried to start ADB when we already have one running!");
  }
};

Android.prototype.timeoutWaitingForCommand = function() {
  logger.info("Didn't get a new command in " + (this.commandTimeoutMs / 1000) +
              " secs, shutting down...");
  //this.adb.sendShutdownCommand(function() {
    //logger.info("Sent shutdown command, waiting for ADB to stop...");
  //});
  this.stop();
};

Android.prototype.stop = function(cb) {
  if (this.commandTimeout) {
    clearTimeout(this.commandTimeout);
  }
  if (this.adb === null) {
    logger.info("Trying to stop adb but it already exited");
    cb();
  } else {
    if (cb) {
      this.onStop = cb;
    }
    this.adb.sendShutdownCommand(_.bind(function() {
      logger.info("Sent shutdown command, waiting for ADB to stop...");
    }, this));
    this.queue = [];
    this.progress = 0;
  }
};

Android.prototype.resetTimeout = function() {
  if (this.commandTimeout) {
    clearTimeout(this.commandTimeout);
  }
  this.commandTimeout = setTimeout(_.bind(this.timeoutWaitingForCommand, this),
      this.commandTimeoutMs);
};

Android.prototype.proxy = deviceCommon.proxy;
Android.prototype.respond = deviceCommon.respond;

Android.prototype.push = function(elem) {

  this.resetTimeout();
  this.queue.push(elem);

  var next = _.bind(function() {
    if (this.queue.length <= 0 || this.progress > 0) {
      return;
    }

    var target = this.queue.shift()
      , action = target[0][0]
      , params = typeof target[0][1] === "undefined" ? {} : target[0][1]
      , cb = target[1];

    this.cbForCurrentCmd = cb;

    this.progress++;

    if (this.adb) {
      this.adb.sendAutomatorCommand(action, params, _.bind(function(response) {
        this.cbForCurrentCmd = null;
        if (typeof cb === 'function') {
          this.respond(response, cb);
        }

        // maybe there's moar work to do
        this.progress--;
        next();
      }, this));
    } else {
      this.cbForCurrentCmd = null;
      this.respond({
        status: status.codes.UnknownError.code
        , value: "Tried to send command to non-existent Android device, " +
                 "maybe it shut down?"
      }, cb);
      this.progress--;
      next();
    }
  }, this);

  next();
};

Android.prototype.waitForCondition = deviceCommon.waitForCondition;

Android.prototype.setCommandTimeout = function(secs, cb) {
  this.origCommandTimeoutMs = this.commandTimeoutMs;
  this.commandTimeoutMs = secs * 1000;
  this.resetTimeout();
  cb(null, {
    status: status.codes.Success.code
    , value: ''
  });
};

Android.prototype.resetCommandTimeout = function(cb) {
  this.commandTimeoutMs = this.origCommandTimeoutMs;
  this.resetTimeout();
  cb(null, {
    status: status.codes.Success.code
    , value: ''
  });
};

Android.prototype.getCommandTimeout = function(cb) {
  this.resetTimeout();
  cb(null, {
    status: status.codes.Success.code
    , value: this.commandTimeoutMs / 1000
  });
};

Android.prototype.findElement = function(strategy, selector, cb) {
  this.findElementOrElements(strategy, selector, false, "", cb);
};

Android.prototype.findElements = function(strategy, selector, cb) {
  this.findElementOrElements(strategy, selector, true, "", cb);
};

Android.prototype.findElementOrElements = function(strategy, selector, many, context, cb) {
  var params = {
    strategy: strategy
    , selector: selector
    , context: context
    , multiple: many
  };
  var doFind = _.bind(function(findCb) {
    this.proxy(["find", params], function(err, res) {
      if (!many && res.status === 0) {
        findCb(true, err, res);
      } else if (many && res.value.length > 0) {
        findCb(true, err, res);
      } else {
        findCb(false, err, res);
      }
    });
  }, this);
  this.waitForCondition(this.implicitWaitMs, doFind, cb);
};

Android.prototype.findElementFromElement = function(element, strategy, selector, cb) {
  this.findElementOrElements(strategy, selector, false, element, cb);
};

Android.prototype.findElementsFromElement = function(element, strategy, selector, cb) {
  this.findElementOrElements(strategy, selector, true, element, cb);
};

Android.prototype.setValueImmediate = function(elementId, value, cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.setValue = function(elementId, value, cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.click = function(elementId, cb) {
  this.proxy(["element:click", {elementId: elementId}], cb);
};

Android.prototype.complexTap = function(tapCount, touchCount, duration, x, y, elementId, cb) {
  this.proxy(["click", {x: x, y: y}], cb);
};

Android.prototype.clear = function(elementId, cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.getText = function(elementId, cb) {
  this.proxy(["element:getText", {elementId: elementId}], cb);
};

Android.prototype.getAttribute = function(elementId, attributeName, cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.getLocation = function(elementId, cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.getSize = function(elementId, cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.getWindowSize = function(windowHandle, cb) {
  this.proxy(["getDeviceSize"], cb);
};

Android.prototype.getPageIndex = function(elementId, cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.keys = function(elementId, keys, cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.frame = function(frame, cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.implicitWait = function(ms, cb) {
  this.implicitWaitMs = parseInt(ms, 10);
  logger.info("Set Android implicit wait to " + ms + "ms");
  cb(null, {
    status: status.codes.Success.code
    , value: null
  });
};

Android.prototype.elementDisplayed = function(elementId, cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.elementEnabled = function(elementId, cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.getPageSource = function(cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.getAlertText = function(cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.postAcceptAlert = function(cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.postDismissAlert = function(cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.getOrientation = function(cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.setOrientation = function(orientation, cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.getScreenshot = function(cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.fakeFlick = function(xSpeed, ySpeed, swipe, cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.fakeFlickElement = function(elementId, xoffset, yoffset, speed, cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.swipe = function(startX, startY, endX, endY, duration, touchCount, elId, cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.flick = function(startX, startY, endX, endY, touchCount, elId, cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.hideKeyboard = function(keyName, cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.url = function(url, cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.active = function(cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.getWindowHandle = function(cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.getWindowHandles = function(cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.setWindow = function(name, cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.clearWebView = function(cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.execute = function(script, args, cb) {
    cb(new NotImplementedError(), null);
};

Android.prototype.title = function(cb) {
    cb(new NotImplementedError(), null);
};

module.exports = function(opts) {
  return new Android(opts);
};
