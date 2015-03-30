'use strict';

var _ = require('lodash');
var Q = require('q');
var util = require('util');
var buffer_utils = require('../util/buffer_utils');
var ice_api = require('../util/ice_api');
var ice_lib = require('../util/ice_lib');
var dbg = require('noobaa-util/debug_module')(__filename);

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
                dbg.log0('RPC ICE FAILED', message.path, 'peer', options.peer, 'status', res.status);
                var err = new Error('RPC ICE FAILED ' + message.path + ' status ' + res.status);
                err.statusCode = res.status;
                throw err;
            }
            return res.data;
        }, function(err) {
            dbg.log0('RPC ICE EXCEPTION', message.path, err);
            // close the channel to try and recover
            // TODO is this really the right thing to do?
            ice_api.forceCloseIce(options.p2p_context, options.peer);
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
                dbg.log0('RPC WS FAILED', message.path, 'peer', options.peer, 'status', res.status);
                var err = new Error('RPC WS FAILED ' + message.path + ' status ' + res.status);
                err.statusCode = res.status;
                throw err;
            }
            return res.data;
        }, function(err) {
            dbg.log0('RPC WS EXCEPTION', message.path, err);
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

    function handle_request(channel, message) {

        var msg;
        var body;
        var reqId;
        var isWs = false;
        var rpc_method;

        return Q.fcall(function() {

                // TODO YAEL - explain these cases. better simplify them.

                if (typeof message === 'string' || message instanceof String) {
                    msg = JSON.parse(message);
                    reqId = msg.req || msg.requestId;
                    body = msg.body;
                    dbg.log0('ice do something ' + util.inspect(msg));
                } else if (message instanceof ArrayBuffer) {
                    try {
                        reqId = (buffer_utils.toBuffer(message.slice(0, 32))
                            .readInt32LE(0)).toString();
                    } catch (ex) {
                        dbg.log0('problem reading req id rest_api ' + ex);
                    }
                    var msgObj = channel.msgs[reqId];
                    body = msgObj.buffer;
                    msg = msgObj.peer_msg;
                    dbg.log0('ice do something with buffer ' + util.inspect(msg) + ' for req ' + reqId);
                } else if (message.method) {
                    msg = message;
                    body = msg.body;
                    reqId = msg.req || msg.requestId;
                    dbg.log0('ice do something json ' + util.inspect(message) + ' req ' + reqId);
                } else {
                    dbg.log0('ice got weird msg', message);
                }

                if (msg.sigType) {
                    isWs = true;
                }

                var reqMsg = msg;
                var reqBody = body;
                if (body && body.body) {
                    reqMsg = body;
                    reqBody = body.body;
                }

                // skip first split item if empty due to leading '/'
                var path_split = reqMsg.path.split('/', 4);
                var api_name = path_split.shift() || path_split.shift();
                var method_name = path_split.shift();
                var domain = path_split.shift();
                rpc_method = rpc.get_service_method(api_name, method_name, domain);

                if (!rpc_method) {
                    throw {
                        statusCode: 400,
                        data: 'RPC: no such method ' + reqMsg.path
                    };
                }

                dbg.log0('reqMsg', reqMsg, 'reqBody', reqBody);
                var rpc_req = {};
                if (rpc_method.method_api.param_raw) {
                    rpc_req.rpc_params = reqMsg.body;
                    rpc_req.rpc_params[rpc_method.method_api.param_raw] = reqBody;
                } else {
                    rpc_req.rpc_params = reqBody;
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
                dbg.log0('RPC ICE FAILED ',reqId, err.stack || err);
                return send_reply(500, err.toString(), null);
            });


        function send_reply(status, data, buffer) {
            return Q.fcall(function() {
                    if (buffer && !(buffer instanceof ArrayBuffer)) {
                        buffer = buffer_utils.toArrayBuffer(buffer);
                    }

                    dbg.log0('done manual status: ' + status + " reply: " + data + ' buffer: ' + (buffer ? buffer.byteLength : 0) + ' req ' + reqId);

                    var reply = {
                        status: status,
                        statusCode: status,
                        size: (buffer ? buffer.byteLength : 0),
                        data: data,
                        req: reqId
                    };

                    if (isWs) {
                        reply.sigType = 'response';
                        reply.requestId = reqId;
                        reply.from = msg.to;
                        reply.to = msg.from;
                    }

                    if (isWs) {
                        // TODO isn't there a callback to WS send? need to return to promise chain..
                        channel.send(JSON.stringify(reply));
                    } else {
                        return ice_lib.writeToChannel(channel, JSON.stringify(reply), reqId);
                    }
                })
                .then(function() {

                    if (!buffer) return;

                    if (isWs) {
                        throw new Error('UNEXPECTED BUFFER WITH WS ' + rpc_method.method_api.name);
                    }

                    return ice_api.writeBufferToSocket(channel, buffer, reqId);
                });
        }
    }

    return ice_api.signalingSetup(handle_request, peer_id);
}
