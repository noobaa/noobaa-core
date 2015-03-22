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
        var self = this;
        stream.Transform.call(self, options);
        self._init(options);
        self.transformer = true;

        // set error handler to forward errors to pipes
        // otherwise pipelines are harder to write without missing error events
        // that are emitted on middle transform streams.
        self.on('error', function(err) {
            self.transformer_forward_error(err);
        });
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
                })
                .done(function(data) {
                    callback(null, data);
                }, function(err) {
                    console.log('transformer error', err);
                    self.transformer_error(err);
                });
        };
    }

    if (params.flush) {
        Transformer.prototype._flush = function(callback) {
            var self = this;
            Q.fcall(function() {
                    return params.flush.call(self);
                })
                .done(function() {
                    callback();
                }, function(err) {
                    console.log('transformer flush error', err);
                    self.transformer_error(err);
                });
        };
    }

    Transformer.prototype.transformer_error = function(err) {
        var self = this;

        // emit error is deferred with setTimeout to avoid skiping
        // error handlers that want to register in the current stack
        setTimeout(function() {

            // emit error always throws the err immediately,
            // so we catch and ignore
            try {
                self.emit('error', err);
            } catch (e) {}

            // transformers already know to forward by their error handler
            // but for non transformer streams we manualy forward here
            if (!self.transformer) {
                Transformer.prototype.transformer_forward_error.call(self, err);
            }

        }, 0);
    };

    /**
     * forward error to pipes
     */
    Transformer.prototype.transformer_forward_error = function(err) {

        // TODO unneeded with pipeline ??
        if (true) return;

        var state = this._readableState;
        if (!state || !state.pipes) return;

        if (state.pipesCount === 1) {
            Transformer.prototype.transformer_error.call(state.pipes, err);
        } else {
            for (var i = 0; i < state.pipes.length; ++i) {
                Transformer.prototype.transformer_error.call(state.pipes[i], err);
            }
        }
    };

    return Transformer;
}
