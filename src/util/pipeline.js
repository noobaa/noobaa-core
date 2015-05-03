// module targets: nodejs & browserify
'use strict';

var _ = require('lodash');
var Q = require('q');


module.exports = Pipeline;


/**
 *
 * Pipeline
 *
 * Create a pipeline of transforming streams
 *
 */
function Pipeline(source_stream) {
    this._last = source_stream;
    this._queue = [source_stream];
    this._defer = Q.defer();
}

Pipeline.prototype.notify = function(progress){
    this._defer.notify(progress);
};
Pipeline.prototype.pipe = function(next) {
    next.on('error', this.on_error.bind(this));
    next.on('close', this.on_close.bind(this));
    this._last = this._last.pipe(next);
    this._queue.push(next);
    return this;
};

Pipeline.prototype.run = function() {
    var self = this;
    self._last.on('finish', function() {
        self._defer.resolve();
    });
    self._last = null;
    return self._defer.promise;
};

Pipeline.prototype.on_error = function(err) {
    this._defer.reject(err);
    _.each(this._queue, function(strm) {
        strm.emit('close');
    });
};

Pipeline.prototype.on_close = function() {
    this._defer.reject(new Error('pipeline closed'));
    _.each(this._queue, function(strm) {
        strm.emit('close');
    });
};
