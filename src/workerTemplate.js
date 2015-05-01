'use strict';

var worker = function () {
    self.window = self;
    function ManagedWorker() {
        this._id = -1;
        this._listeners = {};
    }
    ManagedWorker.prototype.on = function (event, callback) {
        if (this._listeners[event])
            throw new RangeError('there is already a listener for ' + event);
        if (typeof callback !== 'function')
            throw new TypeError('callback argument must be a function');
        this._listeners[event] = callback;
    };
    ManagedWorker.prototype.send = function (data) {
        self.postMessage(data);
    };
    ManagedWorker.prototype.trigger = function (event, args) {
        if (!this._listeners[event])
            throw new Error('event ' + event + ' is not defined');
        this._listeners[event].apply(null, args);
    };
    var worker = new ManagedWorker();
    self.onmessage = function (event) {
        switch(event.data.action) {
            case 'init':
                worker._id = event.data.id;
                if (event.data.deps) {
                    importScripts.apply(self, event.data.deps);
                }
                break;
            case 'exec':
                worker.trigger(event.data.event, event.data.args);
                break;
            case 'ping':
                worker.send('pong');
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
