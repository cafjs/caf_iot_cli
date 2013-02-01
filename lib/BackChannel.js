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
 * A backchannel to pull notifications from a CA.
 *
 * Provides a 'notified' event containing a new notification as argument.
 *
 */
var util = require('util');
var Channel = require('./Channel').Channel;
var caf = require('caf_core');
var myutils = caf.myutils;

/**
 * see type of 'spec' in Channel. BackChannel also adds a mandatory
 * attribute 'req' with value an object of similar type to
 *  Channel.prototype.invokeAsync 'req' arg.
 *
 * @constructor
 */
var BackChannel = exports.BackChannel = function(spec, req) {
    Channel.call(this, spec);
    this.req = myutils.clone(req);
    this.url = this.url + '/backchannel';
};
util.inherits(BackChannel, Channel);

BackChannel.prototype.pull = function() {
    var self = this;
    var cb = function(err, notif) {
        if (err) {
            if (err !== 'timeout') {
                var logMsg = 'BackChannel: got non-timeout app error ' +
                    JSON.stringify(err);
                self.log && self.log.warn(logMsg);
            }
        } else {
            if (notif) {
                self.emit('notified', notif);
            }
        }
        self._nextPull();
    };
    if (this.alive) {
        this.invokeAsync(this.req, cb);
    } else {
        var logMsg = 'BackChannel: pulling in a shutdown channel';
        this.log && this.log.debug(logMsg);
    }

};

BackChannel.prototype._nextPull = function() {
    var self = this;
    process.nextTick(function() { self.pull();});
};

/**
 * Override handler for badly formatted responses so that it
 *  throttles the backchannel by trying again the same request (as
 * opposed to creating a new one).
 *
 */
BackChannel.prototype.badMessageHandler = function(httpReq, response, cb) {
    // call 'ignore' just to log response (i.e., no 'cb' param)
    this.ignore(httpReq, response, 'Ignoring badly formed response');
    this.tryAgain(httpReq, 'Ignoring...', cb);
};
