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
 * A channel to send (asynchronous) requests  to a CA.
 *
 *  It emits events:
 *     'error' when connection is permanently lost.
 *     'badToken' when authentication failed.
 */
var http = require('http');
var util = require('util');
var events = require('events');
var assert = require('assert');
var request = require('request');
var caf = require('caf_core');
var json_rpc = caf.json_rpc;


/**
 *  Do 'f' at most 'max' times with a 'timeout' in msec
 * between invocations.
 *
 * 'f' type is function(cb0) ->  undefined
 *
 * 'cb0' is called inside 'f' with (err, value):
 *
 *   if 'err' is not a falsy stop retrying and call top 'cb' with 'err'
 *   or if 'value' is not undefined, call top cb with (err, value)
 *   or else ignore response and retry (when nRetries < max otherwise
 *     give up and call top 'cb' with error).
 *
 *
 */
var doAtMostNTimes = function(f, max, timeout, cb) {
    _doAtMostNTimes(0, f, max, timeout, cb);
};

var _doAtMostNTimes = function(current, f, max, timeout, cb) {
    if (current < max) {
        var cb0 = function(err, value) {
            if (err) {
                cb(err);
            } else if (value !== undefined) {
                cb(err, value);
            } else {
                setTimeout(function() {
                               _doAtMostNTimes(current + 1, f, max, timeout,
                                               cb);
                           }, timeout);
            }
        };
        f(cb0);
    } else {
        cb('Max Retries:' + max + ' exceeded');
    }
};

/**
 * Ajax request using http POST
 *
 *   @constructor
 *
 */
var HTTPRequest = function(url, msg, cookieJar) {
    this.url = url;
    this.msg = msg;
    this.cookieJar = cookieJar;
};

HTTPRequest.prototype.doRequest = function(cb) {
    var self = this;
    /* 'request' uses the lower case 'cookie' header field and Cloud Foundry
     * expects a 'Cookie' field. According to the RFC they should be case
     * insensitive, so this is a CF bug, but for now we just manage the
     * cookies explicitly.
     */
    var cookieStr = this.cookieJar.cookieString({ url: this.url});
    var headers = (cookieStr ? {'Cookie' : cookieStr} : {});
    request({url: this.url,
             jar: false,
             headers: headers,
             json: true,
             body: this.msg,
             method: 'POST'
            }, function(error, response, body) {
                if (error) {
                    cb(error);
                } else {
                    var cookies = response.headers['set-cookie'] || [];
                    cookies.forEach(
                        function(cookie) {
                            self.cookieJar.add(request.cookie(cookie));
                        });
                    // body is JSON-parsed response
                    cb(error, body);
                }
            });
};


/**
 * 'spec' is of type {url : <string>, maxRetries: <integer>,
 *                  retryTimeout: <integer>, log: <logType>,
 *                  cookieJar: < cookieJarType>}
 * but only the attribute 'url' is mandatory.
 *
 * @constructor
 */
var Channel = exports.Channel = function(spec) {
    events.EventEmitter.call(this);
    // max number of concurrent requests to a CA
//    http.globalAgent.maxSockets = spec.maxSockets || 100;
    this.url = spec.url;
    this.maxRetries = spec.maxRetries || 10000000000;
    this.retryTimeout = spec.retryTimeout || 1000; //msec
    this.alive = true;
    this.cookieJar = spec.cookieJar || request.jar();
    this.log = spec.log || null;
};

util.inherits(Channel, events.EventEmitter);

/**
 * Remote asynchronous invocation on a CA.
 *
 * 'req' is a request object  of type {getToken():function, to : string,
 *  from : string, sessionId : string, methodName : string,  argsList: [Object]}
 *
 * where getToken() returns the most up-to-date authentication token.
 *
 * 'cb' is a standard callback function to propagate application-level
 * errors or responses.
 *
 * Non-recoverable system errors are not propagated in the callback, instead
 * we emit the 'error' event when the channel has been (permanently) disabled.
 * In those cases the callback response would be null and,
 * therefore, a client of this channel should also listen to channel events.
 *
 * Authentication errors emit 'badToken', it is expected that the session
 * will promptly re-login and refresh the token (that will be passed to this
 * Channel with req.getToken()).
 *
 * The channel will retry transparently trying to fix recoverable errors or
 * to redirect requests until we hit a limit of retries.
 */
Channel.prototype.invokeAsync = function(req, cb) {
    assert.ok(this.alive);
    var self = this;
    var f = function(cb0) {
        var args = [req.getToken(), req.to, req.from, req.sessionId,
                    req.methodName].concat(req.argsList);
        var msg = json_rpc.request.apply(json_rpc.request, args);
        var httpReq = new HTTPRequest(self.url, msg, self.cookieJar);
        httpReq.lastToken = args[0];
        self._invokeAsync(httpReq, cb0);
    };
    doAtMostNTimes(f, this.maxRetries, this.retryTimeout, cb);
};

Channel.prototype._invokeAsync = function(httpReq, cb) {
    var self = this;
    var cb0 = function(err, response) {
        if (err) {
            self.transportErrorHandler(httpReq, err, cb);
        } else {
            if (httpReq.msg.id !== response.id) {
                self.badMessageHandler(httpReq, response, cb);
            } else if (json_rpc.isSystemError(response)) {
                self.systemErrorHandler(httpReq, response, cb);
            } else if (json_rpc.isAppReply(response)) {
                self.appReplyHandler(httpReq, response, cb);
            } else {
                self.badMessageHandler(httpReq, response, cb);
            }
        }
    };
    httpReq.doRequest(cb0);
};

Channel.prototype.transportErrorHandler = function(httpReq, error, cb) {
    this.die(httpReq, error, 'Transport Error', cb);
};

Channel.prototype.badMessageHandler = function(httpReq, response, cb) {
    this.ignore(httpReq, response, 'Ignoring badly formed response', cb);
};

Channel.prototype.systemErrorHandler = function(httpReq, response, cb) {
    if (json_rpc.isRedirect(response)) {
        this.tryAgain(httpReq, 'Redirecting...', cb);
    } else if (json_rpc.isNotAuthorized(response)) {
        this.newLogin(httpReq, 'Not Authorized... Refreshing token', cb);
    } else if (json_rpc.isErrorRecoverable(response)) {
        this.tryAgain(httpReq, 'Recovering...', cb);
    } else {
        this.die(httpReq, response, 'Unrecoverable system error', cb);
    }
};

Channel.prototype.appReplyHandler = function(httpReq, response, cb) {
    var allLogMsg = 'Channel: Request:' + JSON.stringify(httpReq) +
        ' Response:' + JSON.stringify(response);
    this.log && this.log.trace(allLogMsg);
    var error = json_rpc.getAppReplyError(response);
    var data = json_rpc.getAppReplyData(response);
    cb(error, data);
};

Channel.prototype.tryAgain = function(httpReq, logMsg, cb) {
    var allLogMsg = 'Channel: ' + logMsg + ' retrying Request:' +
        JSON.stringify(httpReq);
    this.log && this.log.debug(allLogMsg);
    cb(null, undefined);
};

Channel.prototype.newLogin = function(httpReq, logMsg, cb) {
    var allLogMsg = 'Channel: ' + logMsg + ' retrying Request:' +
        JSON.stringify(httpReq);
    this.log && this.log.debug(allLogMsg);
    this.emit('badToken', httpReq.lastToken);
    // try again the request.
    cb(null, undefined);
};


Channel.prototype.ignore = function(httpReq, response, logMsg, cb) {
    var allLogMsg = 'Channel: ' + logMsg + ' ignoring: Request:' +
        JSON.stringify(httpReq) + ' Response:' + JSON.stringify(response);
    this.log && this.log.debug(allLogMsg);
    cb && cb(null, null);
};

Channel.prototype.die = function(httpReq, error, errMsg, cb) {
    var allLogMsg = 'Channel: ' + errMsg + ' shutting down: Request:' +
        JSON.stringify(httpReq) + ' Response:' + JSON.stringify(error);
    this.log && this.log.debug(allLogMsg);
    this.emit('error');
    this.shutdown();
    // do not propagate system errors in the callback, use 'error' event
    cb(null, null);
};

Channel.prototype.shutdown = function() {
    this.alive = false;
    this.removeAllListeners();
};
