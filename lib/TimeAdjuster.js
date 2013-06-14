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
 * Approximates a time offset to match the server time. This is needed when
 * the IoT device cannot have proper time synchronization by other means, e.g.,
 *  it cannot use NTP.
 *
 * The approach is very similar to NTP: assume symmetric propagation times in
 * a round trip, and pick the shortest round trip time within a window of
 * requests. We also low pass filter the resulting time offsets (if needed).
 *
 *
 */

var MORE_HARM_THAN_GOOD=300;/*Max RTT in msec, larger than that adds too much
                             error */
var MAX_WINDOW_SIZE=8;
var SMOOTH=1.0; // no filtering

var createTimeWindow = function(smooth) {

    var that = {};
    var window = [];
    var lastDelta = 0;

    that.adjust = function(rtt, delta) {
        if (window.length >= MAX_WINDOW_SIZE) {
            window.shift();
        }
        window.push({rtt: rtt, delta: delta});
        var minRTT = 99999999999999999999;
        var minIndex = -1;
        for (var i = 0; i < window.length; i++) {
            if (window[i].rtt < minRTT) {
                minRTT = window[i].rtt;
                minIndex = i;
            }
        }
        // low pass filter with exponential moving average
        lastDelta = Math.round(smooth * window[minIndex].delta +
                               (1 - smooth) * lastDelta);
        return lastDelta;
    };


    return that;
};


var TimeAdjuster = exports.TimeAdjuster = function(smooth) {
    this.t1 = -1;
    this.offset = 0;
    this.window = createTimeWindow(smooth || SMOOTH);

};


TimeAdjuster.prototype.startRequest = function() {
    this.t1 = new Date().getTime();
};


TimeAdjuster.prototype.endRequest = function(response) {
    if (this.t1 > 0) {
        var t2 = response.headers['x-start-time'];
        t2 = t2 && parseInt(t2);
        var t3 = response.headers['x-end-time'];
        t3 = t3 && parseInt(t3);
        if (t2 && t3) {
            var t4 = new Date().getTime();
            var rtt = (t4 - this.t1) - (t3 -t2);
            if (rtt < MORE_HARM_THAN_GOOD) {
                var delta = Math.round(((t2 - this.t1) + (t3 - t4))/2);
                this.offset = this.window.adjust(rtt, delta);
            }
        }
    }
};

TimeAdjuster.prototype.getOffset = function() {
    return this.offset;
};
