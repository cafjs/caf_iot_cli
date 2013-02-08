/*!
Copyright 2013 Hewlett-Packard Development Company, L.P.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

"use strict";
/**
 *
 * A customizable main loop for an IoT device that interacts with a CA.
 *
 *      while(true) {
 *          readSensorsHook(mapOut, cb);  // (1)
 *          <garbage_collect_previous_responses();>
 *          for_each_command_from_CA {
 *              executeCommandHook(command, mapIn, mapOut, cb); // (2)
 *          }
 *          mainHook(mapIn, mapOut, cb); // (3)
 *          <update_map();>
 *          <sync_maps_with_CA();>
 *          <sleep();>
 *      }
 *
 * Hooks that can be customized:
 *
 * (1) Populate the map `mapOut` with sensor data.
 * (2) Mapping of commands to function calls. Invoked once per command.
 * (3) Main function invoked after reading sensors and executing commands.
 *
 * There is no global state, we use `mapOut` and `mapIn` (read-only) maps
 *  to pass information between calls. `mapOut` is eventually send to the CA
 * and `mapIn` is the last version of the map received from the CA.
 *
 * Hooks can contain asynchronous calls, and we use a standard callback
 * mechanism to propagate errors or resume execution.
 *
 *
 * @module caf_iot_cli/MainLoop
 */


var async = require('async');
var request = require('request');


/*
 *
 *  type  for top level maps is {deviceView: iotMapType, caView: iotMapType}
 *
 * and iotMapType is {deviceView: boolean, toCloud: iotOneMapType,
 * fromCloud: iotOneMapType}
 *
 * and iotOneMapType is {version: number, values: Object=}
 */
var emptyView = function() {
    return {deviceView: true, toCloud: {version: 0, values: {}},
            fromCloud: {version: 0, values: {}}};
};

var isEmptyView = function(view) {
    return (view.toCloud.version === 0) && (view.fromCloud.version === 0);
};


var syncMaps = function(spec, maps, cb) {
    var config = (spec && spec.config) || {};

    var req = {url: config.url,
               proxy: config.proxy || undefined,
               jar: false,
               json: true,
               body: maps.deviceView || {},
               method: 'POST'
              };
    request(req, function (err, response, body) {
                if (err) {
                    cb(err);
                } else {
                    if (typeof body === 'object') {
                        if (Array.isArray(body)) {
                            if (body.length !== 2) {
                                cb(body);
                            } else {
                                // version was not ok, it is reseting
                                maps.deviceView = JSON.parse(body[0]);
                                if (isEmptyView(maps.deviceView)) {
                                    // do 'init' not a 'resume'
                                    maps.deviceView.toCloud.version = 1;
                                }
                                maps.caView = JSON.parse(body[1]);
                                cb(null);
                            }
                        } else {
                            maps.caView = body;
                            cb(null);
                        }
                    } else {
                        // string is always an error
                        cb(body);
                    }
                }
            });
};

var gcResponses = function(maps) {
    var toCloud = maps.deviceView.toCloud;
    var commands = toCloud && toCloud.values && toCloud.values.commands;
    var lastModifVersion = commands && commands.lastModified;
    var lastSeenVersion = maps.caView && maps.caView.toCloud &&
        maps.caView.toCloud.version;
    if (lastSeenVersion && lastModifVersion &&
        (lastSeenVersion >= lastModifVersion) && commands && commands.values) {
        // CA has seen the last version, do not send replies again
        commands.firstIndex = commands.firstIndex + commands.values.length;
        delete commands.lastModified;
        commands.values = [];
        return true;
    }
    return false;
};

var getCommands = function(maps) {
    var fromCloud = maps.caView.fromCloud;
    var fromCloudCommands = (fromCloud.values && fromCloud.values.commands) ||
        {};
    var toCloud = maps.deviceView.toCloud;
    var toCloudCommands = (toCloud.values && toCloud.values.commands) || {};
    var firstIndex = toCloudCommands.firstIndex || 0;
    firstIndex = firstIndex + ((toCloudCommands.values &&
                               toCloudCommands.values.length) || 0);
    var firstIndexFromCloud = fromCloudCommands.firstIndex || 0;
    var delta = (firstIndex > firstIndexFromCloud ?
                 firstIndex - firstIndexFromCloud : 0);
    if (fromCloudCommands.values && (fromCloudCommands.values.length > delta)) {
        return {firstIndex: firstIndexFromCloud + delta,
                commands: fromCloudCommands.values.slice(delta)};
    } else {
        return null;
    }
};

var addResponses = function(firstIndex, outputs, maps) {
    var toCloud = maps.deviceView.toCloud;
    toCloud.values = toCloud.values || {};
    toCloud.values.commands =  toCloud.values.commands || {};
    toCloud.values.commands.firstIndex = firstIndex;
    toCloud.values.commands.lastModified = toCloud.version + 1;
    toCloud.values.commands.values = outputs;
};

var updateMaps = function(maps) {
    var toCloud = maps.deviceView.toCloud;
    var fromCloud = maps.deviceView.fromCloud;
    toCloud.version = toCloud.version + 1;
    fromCloud.version = maps.caView.fromCloud.version;
};


// see MainLoop
var mainConstructor = function(spec, maps) {
    var readSensorsHook = spec.readSensorsHook ||
        function(mapOut, cb) { cb(null);};
    var executeCommandHook = spec.executeCommandHook ||
        function(command, mapIn, mapOut, cb) { cb(null);};
    var mainHook = spec.mainHook ||
        function(mapIn, mapOut, cb) { cb(null);};

    var cb = spec.cb ||
        function(err, x) {
            if (err) {  console.log("Got error: " + JSON.stringify(err));
                        process.exit(1);
                     }
        };
    var inProgress = false;
    return function() {
        if (inProgress) {
            return;
        }
        maps.caView = maps.caView || emptyView();
        maps.caView.deviceView = false;
        maps.deviceView = maps.deviceView || emptyView();
        // serialize main loop calls.
        inProgress = true;
        async.series([
                         function(cb0) {
                             readSensorsHook(maps.deviceView.toCloud.values,
                                             cb0);
                         },
                         function(cb0) {
                             gcResponses(maps);
                             var commandObj = getCommands(maps);
                             if (commandObj) {
                                 var commands = commandObj.commands;
                                 var firstIndex = commandObj.firstIndex;
                                 var doIt = function(x, cb1) {
                                     var inMap =  maps.caView.fromCloud.values;
                                     var outMap = maps.deviceView.toCloud
                                         .values;
                                     executeCommandHook(x, inMap, outMap, cb1);
                                 };
                                 async.mapSeries(commands, doIt,
                                                 function(err, outputs) {
                                                     if (err) {
                                                         cb0(err);
                                                     } else {
                                                         addResponses(
                                                             firstIndex,
                                                             outputs, maps);
                                                         cb0(null);
                                                     }
                                                 });
                             } else {
                                 cb0(null);
                             }
                         },
                         function(cb0) {
                             var inMap =  maps.caView.fromCloud.values;
                             var outMap = maps.deviceView.toCloud.values;
                             mainHook(inMap, outMap, cb0);
                         },
                         function(cb0) {
                             if (!isEmptyView(maps.deviceView)) {
                                 updateMaps(maps);
                             }
                             syncMaps(spec, maps,  cb0);
                         }
                     ],
                     function(err, data) {
                         inProgress = false;
                         cb(err, data);
                     });
    };
};


// Public

/**
 * Constructor for the Main Loop object.
 *
 * spec type is
 *
 *     {
 *       config: configType,
 *       readSensorsHook: {function(mapOut:Object, caf.cb)},
 *       executeCommandHook: {function(command:string, mapIn:Object,
 *                            mapOut:Object, caf.cb)},
 *       mainHook:{function(mapIn:Object, mapOut:Object, caf.cb)},
 *       cb: caf.cb // optional callback for error propagation
 *     }
 *
 * where configType is
 *
 *     {
 *        url: {string}, // e.g.,'http://helloworld.cafjs.com/iot/2343432423'
 *        proxy: {string=}, // url with a http proxy (Optional)
 *        interval:number // sleep timeout in seconds
 *     }
 * where mapIn is read-only and mapOut is the map that will be sent to the cloud
 *
 * The hooks do not return a value, we use instead the last call argument
 *  (callback) to propagate errors/values  (and mapOut for propagating values).
 * In particular, the second argument of the callback in `executeCommandHook`
 * contains the result of the command, and the other hooks use `mapOut` to
 * propagate data to the CA.
 *
 * An error in the main loop is propagated to the optional callback `spec.cb`,
 * which decides whether to continue or not. By default we exit the process.
 *
 * @param {Object} spec Config data for the main loop.
 * @constructor
 */
var MainLoop = exports.MainLoop = function(spec) {
    this.interval = (spec && spec.config &&  spec.config.interval) || 1000;
    this.maps = {};
    this.main = mainConstructor(spec, this.maps);
};


// Public API

/**
 *  Starts the main loop.
 *
 *
 */
MainLoop.prototype.start = function() {
    this.intervalId = setInterval(this.main, this.interval);

};

/**
 * Stops the main loop.
 *
 */
MainLoop.prototype.stop = function() {
    if (this.intervalId) {
        clearInterval(this.intervalId);
    };
};

