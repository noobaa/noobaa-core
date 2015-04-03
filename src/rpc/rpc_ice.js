'use strict';

var _ = require('lodash');
var Q = require('q');
var util = require('util');
var buffer_utils = require('../util/buffer_utils');
var ice_api = require('../util/ice_api');
var ice_lib = require('../util/ice_lib');
var config = require('../../config.js');
var dbg = require('noobaa-util/debug_module')(__filename);

dbg.set_level(config.dbg_log_level);

module.exports = {
    request: request,
    request_ws: request_ws,
    serve: serve,
};

/**
 *
 * request
 *
 * send rpc request over ICE
 *
 */
function request(rpc, api, method_api, params, options) {
    var buffer = params[method_api.param_raw];
    var message = {
        path: '/' + api.name + '/' + method_api.name + '/' + options.domain,
        method: method_api.method,
        body: method_api.param_raw ?
            _.omit(params, method_api.param_raw) : params
    };

    return ice_api.sendRequest(
            options.p2p_context,
            options.ws_socket,
            options.peer,
            message,
            null,
            buffer,
            options.timeout)
        .then(function(res) {
            if (res && res.status !== 200) {
                dbg.error('RPC ICE FAILED', message.path, 'peer', options.peer, 'status', res.status);
                var err = new Error('RPC ICE FAILED ' + message.path + ' status ' + res.status);
                err.statusCode = res.status;
                throw err;
            }
            return res.data;
        }, function(err) {
            dbg.error('RPC ICE EXCEPTION', message.path, err);
            throw err;
        });

}



/**
 *
 * request_ws
 *
 * send rpc request over websocket
 *
 */
function request_ws(rpc, api, method_api, params, options) {
    var message = {
        path: '/' + api.name + '/' + method_api.name + '/' + options.domain,
        method: method_api.method,
        body: params
    };

    return ice_api.sendWSRequest(
            options.p2p_context,
            options.peer,
            message,
            options.timeout)
        .then(function(res) {
            if (res && res.status !== 200) {
                dbg.error('RPC WS FAILED', message.path, 'peer', options.peer, 'status', res.status);
                var err = new Error('RPC WS FAILED ' + message.path + ' status ' + res.status);
                err.statusCode = res.status;
                throw err;
            }
            return res.data;
        }, function(err) {
            dbg.error('RPC WS EXCEPTION', message.path, err);
            throw err;
        });
}




/**
 *
 * serve
 *
 * start serving rpc requests
 *
 */
function serve(rpc, peer_id) {

    function handle_request(socket, channel, msgObj) {

        var msg = msgObj.peer_msg;
        var reqId = msgObj.requestId;
        var rpc_method;

        return Q.fcall(function() {

                if (!msg.path) {
                    throw {
                        statusCode: 400,
                        data: 'RPC: no method sent'
                    };
                }

                // skip first split item if empty due to leading '/'
                var path_split = msg.path.split('/', 4);
                var api_name = path_split.shift() || path_split.shift();
                var method_name = path_split.shift();
                var domain = path_split.shift();
                rpc_method = rpc.get_service_method(api_name, method_name, domain);

                if (!rpc_method) {
                    throw {
                        statusCode: 400,
                        data: 'RPC: no such method ' + msg.path
                    };
                }

                dbg.log0('reqId', reqId, 'msg', msg);
                var rpc_req = {};
                if (rpc_method.method_api.param_raw) {
                    rpc_req.rpc_params = msg.body;
                    rpc_req.rpc_params[rpc_method.method_api.param_raw] = msgObj.buffer;
                } else {
                    rpc_req.rpc_params = msg.body;
                }

                return rpc_method.handler(rpc_req);
            })
            .then(function(reply) {
                if (rpc_method.method_api.reply_raw) {
                    return send_reply(200, null, reply);
                } else {
                    return send_reply(200, reply, null);
                }
            }, function(err) {
                dbg.error('RPC ICE FAILED ', reqId, err.stack || err);
                return send_reply(err.statusCode || 500, err.toString(), null);
            });

        function send_reply(status, data, buffer) {
            var reply;
            return Q.fcall(function() {

                    dbg.log0('done manual status: ' + status + " reply: " + data + ' buffer: ' + (buffer ? buffer.length : 0) + ' req ' + reqId, 'from', msgObj.from || channel.peerId);

                    reply = {
                        status: status,
                        statusCode: status,
                        size: (buffer ? buffer.length : 0),
                        data: data,
                        req: reqId
                    };

                    if (msgObj.isWS) {
                        if (buffer) {
                            throw new Error('UNEXPECTED BUFFER WITH WS ' + rpc_method.method_api.name);
                        }
                        reply.sigType = 'response';
                        reply.requestId = reqId;
                        reply.from = msgObj.to;
                        reply.to = msgObj.from;

                        // TODO isn't there a callback to WS send? need to return to promise chain..
                        dbg.log2('done return ws reply ', reqId, reply);
                        return channel.send(JSON.stringify(reply));
                    } else {
                        // write has timeout internally
                        dbg.log2('done return ice reply ', reqId, channel.peerId, reply);
                        return ice_api.writeMessage(socket, channel, reply, buffer, reqId);
                    }
                })
                .then(function() {
                    dbg.log3('done request, close conn if needed ', reqId,
                        'from', msgObj.from || channel.peerId);
                    try {
                        ice_lib.closeIce(socket, reqId, msgObj.isWS ? null : channel, true);
                    } catch (err) {
                        dbg.error('closeIce err ' + reqId, err);
                    }
                })
                .then(null, function(err) {
                    dbg.log3('send_reply error ', reqId, err);
                    try {
                        ice_lib.closeIce(socket, reqId, msgObj.isWS ? null : channel, true);
                    } catch (ex) {
                        dbg.error('closeIce ex on err ' + reqId, ex);
                    }
                    throw err;
                });
        }
    }

    return ice_api.signalingSetup(handle_request, peer_id);
}
