(function webpackUniversalModuleDefinition(root, factory) {
	if(typeof exports === 'object' && typeof module === 'object')
		module.exports = factory();
	else if(typeof define === 'function' && define.amd)
		define([], factory);
	else if(typeof exports === 'object')
		exports["WorkerManager"] = factory();
	else
		root["WorkerManager"] = factory();
})(this, function() {
return /******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};

/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {

/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId])
/******/ 			return installedModules[moduleId].exports;

/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			exports: {},
/******/ 			id: moduleId,
/******/ 			loaded: false
/******/ 		};

/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);

/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;

/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}


/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;

/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;

/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";

/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(0);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var workerTemplate = __webpack_require__(1);

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
	        worker.id = i;
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
	        callback[1](error.message);
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
	        callback[0](event.data.data);
	    }
	    this._workers.set(worker, null);
	    this._exec();
	};

	WorkerManager.prototype._exec = function () {
	    for (var worker of this._workers.keys()) {
	        if (this._working === this._numWorkers ||
	            this._waiting.length === 0) {
	            return;
	        }
	        if (!worker.running) {
	            for (var i = 0; i < this._waiting.length; i++) {
	                var execInfo = this._waiting[i];
	                if (typeof execInfo[3] === 'number' && execInfo[3] !== worker.id) {
	                    // this message is intended to another worker, let's ignore it
	                    continue;
	                }
	                this._waiting.splice(i, 1);
	                worker.postMessage({
	                    action: 'exec',
	                    event: execInfo[0],
	                    args: execInfo[1]
	                });
	                worker.running = true;
	                worker.time = Date.now();
	                this._workers.set(worker, execInfo[2]);
	                this._working++;
	                break;
	            }
	        }
	    }
	};

	WorkerManager.prototype.terminate = function () {
	    if (this._terminated) return;
	    for (var entry of this._workers) {
	        entry[0].terminate();
	        if (entry[1]) {
	            entry[1][1](new Error('Terminated'));
	        }
	    }
	    this._workers.clear();
	    this._waiting = [];
	    this._working = 0;
	    this._terminated = true;
	};

	WorkerManager.prototype.postAll = function (event, args) {
	    if (this._terminated)
	        throw new Error('Cannot post (terminated)');
	    var promises = [];
	    for (var worker of this._workers.keys()) {
	        promises.push(this.post(event, args, worker.id));
	    }
	    return Promise.all(promises);
	};

	WorkerManager.prototype.post = function (event, args, id) {
	    if (args === undefined) args = [];
	    if (!Array.isArray(args)) {
	        args = [args];
	    }

	    var self = this;
	    return new Promise(function (resolve, reject) {
	        if (self._terminated) throw new Error('Cannot post (terminated)');
	        self._waiting.push([event, args, [resolve, reject], id]);
	        self._exec();
	    });
	};

	module.exports = WorkerManager;


/***/ },
/* 1 */
/***/ function(module, exports) {

	'use strict';

	var worker = function () {
	    var window = self.window = self;
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

	exports.newWorkerURL = function newWorkerURL(code, deps) {
	    var blob = new Blob(['(', workerStr[0], 'importScripts.apply(self, ' + JSON.stringify(deps) + ');\n', '(', code, ')();', workerStr[1], ')();'], {type: 'application/javascript'});
	    return URL.createObjectURL(blob);
	};


/***/ }
/******/ ])
});
;