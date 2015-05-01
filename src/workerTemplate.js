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
