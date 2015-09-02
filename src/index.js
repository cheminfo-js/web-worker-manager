'use strict';

var workerTemplate = require('./workerTemplate');

var CORES = navigator.hardwareConcurrency || 1;

var noop = Function.prototype;

function WorkerManager(func, options) {
    // Check arguments
    if (typeof func !== 'string' && typeof func !== 'function')
        throw new TypeError('func argument must be a function');
    if (options === undefined)
        options = {};
    if (typeof options !== 'object' || options === null)
        throw new TypeError('options argument must be an object');

    this._workerCode = func.toString();

    // Parse options
    this._numWorkers = (options.maxWorkers > 0) ? Math.min(options.maxWorkers, CORES) : CORES;
    this._workers = new Map();
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

    this._init(deps);
}

WorkerManager.prototype._init = function (deps) {
    var workerURL = workerTemplate.newWorkerURL(this._workerCode, deps);

    for (var i = 0; i < this._numWorkers; i++) {
        var worker = new Worker(workerURL);
        worker.onmessage = this._onmessage.bind(this, worker);
        worker.onerror = this._onerror.bind(this, worker);
        worker.running = false;
        this._workers.set(worker, null);
    }

    URL.revokeObjectURL(workerURL);
};

WorkerManager.prototype._onerror = function (worker, error) {
    if (this._terminated)
        return;
    this._working--;
    worker.running = false;
    var callback = this._workers.get(worker);
    if (callback) {
        callback(error);
    }
    this._workers.set(worker, null);
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
    worker.running = false;
    var callback = this._workers.get(worker);
    if (callback) {
        callback(null, event.data.data);
    }
    this._workers.set(worker, null);
    this._exec();
};

WorkerManager.prototype._exec = function () {
    if (this._working === this._numWorkers ||
        this._waiting.length === 0) {
        return;
    }
    for (var worker of this._workers.keys()) {
        if (!worker.running) {
            var execInfo = this._waiting.shift();
            worker.postMessage({
                action: 'exec',
                id: id,
                event: execInfo[0],
                args: execInfo[1]
            });
            worker.running = true;
            worker.time = Date.now();
            this._workers.set(worker, execInfo[2] || noop);
            this._working++;
            break;
        }
    }
};

WorkerManager.prototype.terminate = function () {
    if (this._terminated) throw new Error('Already terminated');
    for (var entry of this._workers) {
        entry[0].terminate();
        if (entry[1]) {
            entry[1](new Error('Terminated'));
        }
    }
    this._workers.clear();
    this._waiting = [];
    this._working = 0;
    this._terminated = true;
};

/*
TODO change this to use post internally so there is never more than one message
sent at the same time to the worker
 */
/*
WorkerManager.prototype.postAll = function (event, args) {
    if (this._terminated)
        throw new Error('Cannot post (terminated)');
    args = args || [];
    if (!Array.isArray(args))
        args = [args];
    for (var worker of this._workers.keys()) {
        worker.postMessage({
            action: 'exec',
            event: event,
            args: args
        });
    }
};
*/

WorkerManager.prototype.post = function (event, args, callback) {
    if (this._terminated) throw new Error('Cannot post (terminated)');
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
