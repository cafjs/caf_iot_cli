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
 *          sync_maps_with_CA();
 *          read_local_sensors();  // (1)
 *          garbage_collect_responses();
 *          for_each_command_from_CA { execute_command();} // (2)
 *          your_main_hook(); // (3)
 *          update_map();
 *          sleep();
 *      }
 *
 * Hooks that can be customized:
 *
 * (1) Populate the local (`deviceView.toCloud`) map with sensor data.
 * (2) Mapping of commands to function calls. Invoked once per command.
 * (3) Main function invoked after reading sensors and executing commands.
 *
 * There is no global state, we use `deviceView` and `caView` (read-only) maps
 *  to pass information between calls.
 *
 * Hooks can contain asynchronous calls, and we use a standard callback
 * mechanism to implement the main loop.
 *
 *
 * @module caf_iot_cli/MainLoop
 */


var async = require('async');
var request = require('request');

var resetMaps = function(spec, maps, cb) {

};

var syncMaps = function(spec, maps, cb) {
    request({url: spec.url,
             jar: false,
             json: true,
             body: maps.deviceView,
             method: 'POST'
            }, function (err, response, body) {
                if (err) {
                    cb(err);
                } else {
                    if (typeof body === 'object') {
                        maps.caView = body;
                        cb(null);
                    } else {
                        // a string is always an error
                        console.log("Got error: " + body + " reseting");
                        resetMaps(spec, maps, cb);
                    }
                }
            });
};

var gcResponses = function(maps) {


};

var getCommands = function(maps) {

};

var addResponses = function(outputs, maps) {


};

var updateMaps = function(maps) {


};

// see MainLoop
var mainConstructor = function(spec) {

    var dummyHook = function(args, toCloud, fromCloud, cb) {
        cb(null, null);
    };

    var maps = {};
    var readSensorsHook = spec.readSensorsHook || dummyHook;
    var executeCommandHook = spec.executeCommandHook || dummyHook;
    var mainHook = spec.mainHook || dummyHook;
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
        inProgress = true;
        async.series([
                         function(cb0) {
                             syncMaps(spec, maps,  cb0);
                         },
                         function(cb0) {
                             readSensorsHook([], maps, cb0);
                         },
                         function(cb0) {
                             gcResponses(maps);
                             var commands = getCommands(maps);
                             var doIt = function(x, cb1) {
                                 executeCommandHook([x], maps, cb1);
                             };
                             async.mapSeries(commands, doIt,
                                             function(err, outputs) {
                                                 if (err) {
                                                     cb0(err);
                                                 } else {
                                                     addResponses(outputs,
                                                                  maps);
                                                     cb0(null);
                                                 }
                                             });
                         },
                         function(cb0) {
                             mainHook([], maps, cb0);
                         }
                     ],
                     function(err, data) {
                         inProgress = false;
                         if (err) {
                             cb(err);
                         } else {
                             updateMaps(maps);
                             cb(err, data);
                         }
                     });
    };
};


// Public

/**
 * Constructor for the Main Loop object.
 *
 * type for a hook function (i.e., caf.hook):
 *  function(args: Array.<Object>, maps: {deviceView: iotMapType,
 *                                         caView: iotMapType}
 *
 * and iotMapType is {deviceView: boolean, toCloud: iotOneMapType,
 * fromCloud: iotOneMapType}
 *
 * and iotOneMapType is {version: number, values: Object=}
 *
 *
 * where:
 *
 *  `args` contains custom arguments for the hook
 *  `maps` contains two objects: `deviceView` is a writeable map that
 *  will be uploaded to the CA  and `caView` is a read-only map
 *  owned by the CA.
 *   `cb` is a standard node.js callback method
 *
 * The function does not return a value, we use the callback instead.
 *
 * spec format is
 *
 *     {
 *       url: {string}, // e.g.,'http://helloworld.cafjs.com/iot/2343432423'
 *       readSensorsHook: {caf.hook},
 *       executeCommandHook: {caf.hook},
 *       mainHook:{caf.hook},
 *       interval:number // sleep timeout in seconds
 *       cb: caf.cb // optional callback for error propagation
 *     }
 *
 * @param {Object} spec Config data for the main loop.
 * @constructor
 */
var MainLoop = exports.MainLoop = function(spec) {
    this.interval = spec.interval || 1000;
    this.main = mainConstructor(spec);
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

