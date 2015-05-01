/**
 * worker-manager - Worker manager
 * @version v0.0.2
 * @link https://github.com/cheminfo-js/worker-manager
 * @license MIT
 */
!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.WorkerManager=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

var workerTemplate = require('./workerTemplate');

var CORES = navigator.hardwareConcurrency || 1;

function noop() {
}

function WorkerManager(func, options) {

    // Check arguments
    if (typeof func !== 'function')
        throw new TypeError('func argument must be a function');
    if (options === undefined)
        options = {};
    if (typeof options !== 'object' || options === null)
        throw new TypeError('options argument must be an object');

    this._workerCode = func.toString();

    // Parse options
    this._numWorkers = (options.maxWorkers > 0) ? Math.min(options.maxWorkers, CORES) : CORES;
    this._workers = new Array(this._numWorkers);
    this._timeout = options.timeout || 0;
    this._terminateOnError = !!options.terminateOnError;

    var deps = options.deps;
    if (typeof deps === 'string')
        deps = [deps];
    if (!Array.isArray(deps))
        deps = undefined;

    this._id = 0;
    this._terminated = false;
    this._working = 0;
    this._waiting = [];
    this._callbacks = {};

    this._init(deps);

}

WorkerManager.prototype._init = function (deps) {

    var workerURL = workerTemplate.newWorkerURL(this._workerCode);

    for (var i = 0; i < this._numWorkers; i++) {
        var worker = new Worker(workerURL);
        worker.postMessage({
            action: 'init',
            deps: deps
        });
        worker.onmessage = this._onmessage.bind(this, worker);
        worker.onerror = this._onerror.bind(this, worker);
        worker.running = false;
        this._workers[i] = worker;
    }

    URL.revokeObjectURL(workerURL);

};

WorkerManager.prototype._onerror = function (worker, error) {

    if (this._terminated)
        return;
    this._working--;
    //TODO find a way to detect which run has failed or cancel and notify all current runs for this worker
    //worker.currentCallback(error);
    worker.running = false;
    if (this._terminateOnError) {
        this.terminate();
    } else {
        this._exec();
    }
};

WorkerManager.prototype._onmessage = function (worker, event) {
    if (this._terminated)
        return;
    this._working--;
    if (this._callbacks[event.data.id]) {
        this._callbacks[event.data.id](null, event.data.data);
        delete this._callbacks[event.data.id];
        worker.running = false;
    }
    this._exec();
};

WorkerManager.prototype._exec = function () {
    if (this._working === this._numWorkers || this._waiting.length === 0)
        return;
    for (var i = 0; i < this._numWorkers; i++) {
        if (!this._workers[i].running) {
            var id = this._id++;
            var execInfo = this._waiting.shift();
            var worker = this._workers[i];
            worker.postMessage({
                action: 'exec',
                id: id,
                event: execInfo[0],
                args: execInfo[1]
            });
            worker.running = true;
            worker.time = Date.now();
            this._callbacks[id] = execInfo[2] || noop;
            this._working++;
            break;
        }
    }
};

WorkerManager.prototype.terminate = function () {
    if (this._terminated)
        return;
    for (var i = 0; i < this._numWorkers; i++) {
        this._workers[i].terminate();
    }
    this._terminated = true;
};

WorkerManager.prototype.postAll = function (event, args) {
    if (this._terminated)
        throw new Error('Cannot post (terminated)');
    args = args || [];
    if (!Array.isArray(args))
        args = [args];
    for (var i = 0; i < this._numWorkers; i++) {
        this._workers[i].postMessage({
            action: 'exec',
            event: event,
            args: args
        });
    }
};

WorkerManager.prototype.post = function (event, args, callback) {
    if (this._terminated)
        throw new Error('Cannot post (terminated)');
    if (typeof args === 'function') {
        callback = args;
        args = [];
    } else if (!Array.isArray(args)) {
        args = [args];
    }
    this._waiting.push([event, args, callback]);
    this._exec();
};

module.exports = WorkerManager;

},{"./workerTemplate":2}],2:[function(require,module,exports){
'use strict';

var worker = function () {
    self.window = self;
    function ManagedWorker() {
        this._listeners = {};
    }
    ManagedWorker.prototype.on = function (event, callback) {
        if (this._listeners[event])
            throw new RangeError('there is already a listener for ' + event);
        if (typeof callback !== 'function')
            throw new TypeError('callback argument must be a function');
        this._listeners[event] = callback;
    };
    ManagedWorker.prototype._send = function (id, data) {
        self.postMessage({
            id: id,
            data: data
        });
    };
    ManagedWorker.prototype._trigger = function (event, args) {
        if (!this._listeners[event])
            throw new Error('event ' + event + ' is not defined');
        this._listeners[event].apply(null, args);
    };
    var worker = new ManagedWorker();
    self.onmessage = function (event) {
        switch(event.data.action) {
            case 'init':
                if (event.data.deps) {
                    importScripts.apply(self, event.data.deps);
                }
                break;
            case 'exec':
                event.data.args.unshift(function (data) {
                    worker._send(event.data.id, data);
                });
                worker._trigger(event.data.event, event.data.args);
                break;
            case 'ping':
                worker.send(event.data.id, 'pong');
                break;
        }
    };
    (("CODE"))
};

var workerStr = worker.toString().split('(("CODE"))');

exports.newWorkerURL = function newWorkerURL(code) {
    var blob = new Blob(['(', workerStr[0], '(', code, ')();', workerStr[1], ')();'], {type: 'application/javascript'});
    return URL.createObjectURL(blob);
};

},{}]},{},[1])(1)
});