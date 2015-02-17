// module targets: nodejs & browserify
'use strict';

var _ = require('lodash');
var Q = require('q');
var util = require('util');
var stream = require('stream');


module.exports = transformer;


/**
 *
 * transformer
 *
 * Create a transforming stream from functions
 *
 * @param params.options (object) options passed to stream.Transform, such as objectMode
 *
 * @param params.init function(options) - called on the stream (as this) on init
 *      to allow initializing state on the stream
 *
 * @param params.transform function(data, encoding) - called on each data item, can return promise.
 *      (data is buffer/string or object in objectMode)
 *
 * @param params.flush function(callback) - called to flush remaining data, can return promise.
 *
 */
function transformer(params) {
    var Transformer = define_transformer(params);
    return new Transformer(params.options);
}


/**
 *
 * returns a transformer class instead of an instance
 *
 */
transformer.ctor = function(params) {
    return define_transformer(params);
};


/**
 *
 * create a transformer stream class from given params
 *
 */
function define_transformer(params) {
    function Transformer(options) {
        stream.Transform.call(this, options);
        this._init(options);
    }
    util.inherits(Transformer, stream.Transform);
    if (params.init) {
        Transformer.prototype._init = params.init;
    } else {
        Transformer.prototype._init = function() {};
    }
    if (params.transform) {
        Transformer.prototype._transform = function(data, encoding, callback) {
            var self = this;
            Q.fcall(function() {
                return params.transform.call(self, data, encoding);
            }).nodeify(callback);
        };
    }
    if (params.flush) {
        Transformer.prototype._flush = function(callback) {
            var self = this;
            Q.fcall(function() {
                return params.flush.call(self);
            }).nodeify(callback);
        };
    }
    return Transformer;
}
