// module targets: nodejs & browserify
'use strict';

var P = require('../util/promise');
var _ = require('lodash');
var util = require('util');
var stream = require('stream');
var promise_utils = require('./promise_utils');


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
        options = options || {};
        stream.Transform.call(self, options);
        self._init.call(null, self, options);
        self._flatten = options.flatten;
        self.transformer = true;
        self._self_push = function(item) {
            if (item) {
                self.push(item);
            }
        };

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


    if (params.transform_parallel) {

        /**
         * data can be a promise - when piped from another transform_parallel
         */
        Transformer.prototype._transform = function(data, encoding, callback) {
            var self = this;
            wait_for_data_item_or_array(data)
                .done(function(data_in) {
                    if (self._flatten && _.isArray(data_in)) {
                        _.each(data_in, function(item) {
                            self._push_parallel(item, encoding);
                        });
                    } else if (data_in) {
                        self._push_parallel(data_in, encoding);
                    }
                    callback();
                }, function(err) {
                    console.log('transformer error', err);
                    self.transformer_error(err);
                });
        };

        /**
         * when transforming in parllel we push a promise into the writable end
         * so that the receiver of the promise will wait for it
         */
        Transformer.prototype._push_parallel = function(data, encoding) {
            var self = this;
            var promise = P.fcall(function() {
                return params.transform_parallel.call(null, self, data, encoding);
            });
            self._self_push(promise);
        };


    } else if (params.transform) {

        /**
         * synchronous transform - waits for every transformation before accepting the next one.
         * data can be a promise - when piped from another transform_parallel
         */
        Transformer.prototype._transform = function(data, encoding, callback) {
            var self = this;
            wait_for_data_item_or_array(data)
                .then(function(data_in) {
                    if (self._flatten && _.isArray(data_in)) {
                        return promise_utils.iterate(data_in, function(item) {
                            return P.when(params.transform.call(null, self, item, encoding))
                                .then(self._self_push);
                        }).thenResolve();
                    } else if (data_in) {
                        return params.transform.call(null, self, data_in, encoding);
                    }
                })
                .done(function(data_out) {
                    self._self_push(data_out);
                    callback();
                }, function(err) {
                    console.log('transformer error', err);
                    self.transformer_error(err);
                });
        };

    } else {

        /**
         * default empty transform only waits for promise
         */
        Transformer.prototype._transform = function(data, encoding, callback) {
            var self = this;
            wait_for_data_item_or_array(data)
                .then(function(data_in) {
                    if (self._flatten && _.isArray(data_in)) {
                        _.each(data_in, self._self_push);
                    } else if (data_in) {
                        self._self_push(data_in);
                    }
                    callback();
                }, function(err) {
                    console.log('transformer error', err);
                    self.transformer_error(err);
                });
        };
    }

    function wait_for_data_item_or_array(data) {
        return _.isArray(data) ? P.all(data) : P.when(data);
    }

    if (params.flush) {
        Transformer.prototype._flush = function(callback) {
            var self = this;
            P.fcall(function() {
                    return params.flush.call(null, self);
                })
                .done(function(data) {
                    if (data) {
                        self.push(data);
                    }
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

            try {
                self.emit('error', err);
            } catch (e) {
                // emit error always throws the err immediately,
                // so we catch and ignore
            }

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
