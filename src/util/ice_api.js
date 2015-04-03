'use strict';

var ice = require('./ice_lib');
var Q = require('q');
var buffer_utils = require('./buffer_utils');
var rand = require('./random_utils');
var dbg = require('noobaa-util/debug_module')(__filename);
var config = require('../../config.js');
var Semaphore = require('noobaa-util/semaphore');
var util = require('util');
var promise_utils = require('../util/promise_utils');

dbg.set_level(config.dbg_log_level);

module.exports = {};

var isAgent;

function onIceMessage(socket, channel, event) {

    dbg.log3('Got event '+event.data+' ; my id: '+channel.myId+' peer '+channel.peerId);
    var msgObj;
    var reqId;
    var p2p_context = socket.p2p_context;

    if (typeof(event.data) === 'string') {
        try {
            var message = JSON.parse(event.data);
            reqId = message.req;

            if (ice.isRequestEnded(p2p_context, reqId, channel)) {
                dbg.log0('got message str ' + event.data + ' my id '+channel.myId+' REQUEST DONE IGNORE '+' peer '+channel.peerId);
                return;
            }

            dbg.log0('got message str ' + event.data + ' my id '+channel.myId+' peer '+channel.peerId);

            if (!channel.msgs[reqId]) {
                channel.msgs[reqId] = {};
            }
            msgObj = channel.msgs[reqId];
            msgObj.peer_msg = message;
            msgObj.requestId = reqId;

            if (!message.size || parseInt(message.size, 10) === 0) {
                if (msgObj.action_defer) {
                    dbg.log3('message str set action defer resolve for req '+reqId);
                    msgObj.action_defer.resolve(channel);
                } else if (channel.handleRequestMethod) {
                    dbg.log3('message str call handleRequestMethod resolve for req '+reqId);
                    channel.handleRequestMethod(socket, channel, msgObj);
                } else {
                    dbg.log2('ab NO 1 to call for req '+reqId);
                }
            } else {
                msgObj.msg_size = parseInt(message.size, 10);
            }

        } catch (ex) {
            dbg.error('ex on string req ' + ex + ' ; ' + ex.stack+' for req '+reqId);
        }
    } else if (event.data instanceof ArrayBuffer) {

        try {
            var buffer = buffer_utils.toBuffer(event.data);
            reqId = (buffer.readInt32LE(0)).toString();
            var part = buffer.readInt32LE(4);

            if (ice.isRequestEnded(p2p_context, reqId, channel)) {
                dbg.log0('got message str ' + event.data + ' my id '+channel.myId+' REQUEST DONE IGNORE');
                return;
            }

            if (!channel.msgs[reqId]) {
                channel.msgs[reqId] = {};
            }
            msgObj = channel.msgs[reqId];
            if (!msgObj.received_size) {
                msgObj.received_size = 0;
            }
            if (!msgObj.chunk_num) {
                msgObj.chunk_num = 0;
            }
            if (!msgObj.chunks_map) {
                msgObj.chunks_map = [];
            }

            var partBuf = buffer.slice(config.iceBufferMetaPartSize);
            if (msgObj.chunks_map[part]) {
                dbg.log3('got EXISTING chunk '+part+' with size ' + partBuf.length + " total size so far " + msgObj.received_size+'/'+msgObj.msg_size +' req '+reqId+' peer '+channel.peerId);
            } else {
                msgObj.chunks_map[part] = partBuf;
                msgObj.chunk_num++;
                msgObj.received_size += partBuf.length;
                dbg.log3('got chunk '+part+' with size ' + partBuf.length + " total size so far " + msgObj.received_size+'/'+msgObj.msg_size +' req '+reqId+' peer '+channel.peerId);
            }

            if (msgObj.msg_size && msgObj.received_size === msgObj.msg_size) {

                dbg.log0('all chunks received last '+part+' with size ' +
                buffer.length + " total size so far " + msgObj.received_size +
                ' my id '+channel.myId+ ' request '+reqId+' peer '+channel.peerId);

                msgObj.buffer = Buffer.concat(msgObj.chunks_map, msgObj.msg_size);

                if (msgObj.action_defer) {
                    dbg.log3('ab set action defer resolve for req '+reqId);
                    msgObj.action_defer.resolve(channel);
                } else if (channel.handleRequestMethod) {
                    try {
                        dbg.log3('ab call handleRequestMethod resolve for req '+reqId);
                        channel.handleRequestMethod(socket, channel, msgObj);
                    } catch (ex) {
                        dbg.log0('ex on ArrayBuffer req ' + ex+' for req '+reqId);
                    }
                } else {
                    dbg.log2('ab NO 1 to call for req '+reqId);
                }
            }
        } catch (ex) {
            dbg.error('ex on ab got ' + ex.stack+' for req '+reqId+' and msg '+(channel && channel.msgs ? Object.keys(channel.msgs) : 'N/A'));
        }
    } else {
        dbg.error('WTF got ' + event.data);
    }
}
module.exports.onIceMessage = onIceMessage;

module.exports.signalingSetup = function (handleRequestMethodTemp, agentId) {
    if (agentId) {
        isAgent = true;
    }
    return ice.setup(onIceMessage, agentId, handleRequestMethodTemp);
};

function generateRequestId() {
    return rand.getRandomInt(10000,9000000).toString();
}


function writeMessage(socket, channel, header, buffer, reqId) {
    return Q.fcall(function() {
            return ice.writeToChannel(socket, channel, JSON.stringify(header), reqId);
        })
        .then(function() {
            dbg.log3('writeMessage write buffer if exists ',reqId,channel.peerId);
            if (buffer) {
                return writeBufferToSocket(socket, channel, buffer, reqId);
            }
        })
        .timeout(config.channel_send_timeout, 'send timeout')
        .then(function() {
            dbg.log3('writeMessage done ',reqId,channel.peerId);
            return;
        })
        .then(null, function(err) {
            dbg.error('writeMessage: SEND FAILED',reqId, err.stack || err);
            // TODO should we close here? not sure as timeouts might occur on long queue of senders
            throw err;
        });
}
module.exports.writeMessage = writeMessage;


function writeBufferToSocket(socket, channel, block, reqId) {

    var sequence = 0;
    var begin = 0;
    var end = config.chunk_size;

    if (end > block.length) {
        end = block.length;
    }

    // define the loop func
    function send_next() {

        // end recursion when done sending the entire buffer
        if (begin === end) {
            dbg.log0('sent last chunk req', reqId, 'chunks', sequence, 'end', end,channel.peerId);
            return;
        }

        // slice the current chunk
        var chunk = ice.createBufferToSend(block.slice(begin, end), sequence, reqId);
        dbg.log3('sending chunk req', reqId, 'chunk', sequence,
            'length', chunk.length, 'begin', begin, 'end', end, channel.peerId);

        // increment sequence and slice buffer to rest of data
        sequence += 1;
        begin = end;
        end = end + config.chunk_size;
        if (end > block.length) {
            end = block.length;
        }

        // send and recurse
         return ice.writeToChannel(socket, channel, chunk, reqId)
         .then(function() {return Q.delay(1);})
         .then(send_next);

    }

    // start sending (recursive async loop)
    return Q.fcall(send_next)
        .then(function(){
            dbg.log3('send_next ended for', reqId,channel.peerId);
            return;
        })
        .then(null, function(err) {
            dbg.error('send_next general error '+err+' '+err.stack+' req '+reqId);
            throw err;
        });

}
module.exports.writeBufferToSocket = writeBufferToSocket;


/********************************
 * handle stale connections
 ********************************/
function closeWS(p2p_context) {
    dbg.log0('REMOVE stale ws connection to remove - client as '+util.inspect(p2p_context.wsClientSocket.ws_socket.idInServer));
    ice.closeSignaling(p2p_context.wsClientSocket.ws_socket);
    clearInterval(p2p_context.wsClientSocket.interval);
    p2p_context.wsClientSocket = null;
}

function staleConnChk(p2p_context) {

    if (!config.doStaleCheck) {
        return;
    }

    if (isAgent || !p2p_context || !p2p_context.wsClientSocket) {
        return;
    }

    dbg.log2('RUNNING staleConnChk WS');

    try {
        var now = (new Date()).getTime();
        var timePassed = now - p2p_context.wsClientSocket.lastTimeUsed;

        if (timePassed > config.connection_ws_stale &&
            (!p2p_context.wsClientSocket.usedBy || Object.keys(p2p_context.wsClientSocket.usedBy).length === 0)) {
            closeWS(p2p_context);
        } else if (timePassed > config.connection_ws_stale) {
            dbg.log0('CANT REMOVE stale ws connection used by: '+util.inspect(p2p_context.wsClientSocket.usedBy));
        }
    } catch (ex) {
        dbg.error('Error on staleConnChk ws ex '+ex+' ; '+ex.stack);
    }
}

function createNewWS() {
    var prob = function(channel, event) {
        dbg.error('ERROR Should never receive ice msgs ! got: '+event.data+' from '+channel.peerId);};
    return ice.setup(prob, null, prob);
}

module.exports.sendWSRequest = function sendWSRequest(p2p_context, peerId, options, timeout) {

    var sigSocket;
    var interval;
    var usedBy;
    var requestId = generateRequestId();

    if (p2p_context && !p2p_context.sem) {
        p2p_context.sem = new Semaphore(1);
    }

    return Q.fcall(function() {

        if (p2p_context) {
            return p2p_context.sem.surround(function() {
                if (p2p_context.wsClientSocket) {
                    sigSocket = p2p_context.wsClientSocket.ws_socket;

                    if (!isAgent) {
                        interval = p2p_context.wsClientSocket.interval;
                        if (!p2p_context.wsClientSocket.usedBy && p2p_context.wsClientSocket.ws_socket) {
                            p2p_context.wsClientSocket.usedBy = {};
                        }
                        usedBy = p2p_context.wsClientSocket.usedBy;
                        usedBy[requestId] = 1;
                        p2p_context.wsClientSocket = {ws_socket: sigSocket, lastTimeUsed: new Date().getTime(), interval: interval, usedBy: usedBy};
                    }
                } else {
                    dbg.log0('CREATE NEW WS CONN (with context) - peer '+peerId+' req '+requestId);
                    sigSocket = createNewWS();
                    if (!isAgent) {
                        interval = setInterval(function(){staleConnChk(p2p_context);}, config.check_stale_conns);
                        usedBy = {};
                        usedBy[requestId] = 1;
                        sigSocket.p2p_context = p2p_context;
                        p2p_context.wsClientSocket = {ws_socket: sigSocket, lastTimeUsed: new Date().getTime(), interval: interval, usedBy: usedBy};
                    }
                }
                if (sigSocket.conn_defer) {
                    return sigSocket.conn_defer.promise.timeout(config.ws_conn_timeout, 'connection ws timeout');
                }
                return Q.fcall(function() {return sigSocket;}).timeout(config.ws_conn_timeout, 'connection ws timeout');
            });
        } else {
            dbg.log0('CREATE NEW WS CONN (no context) - peer '+peerId+' req '+requestId);
            sigSocket = createNewWS();

            if (sigSocket.conn_defer) {
                return sigSocket.conn_defer.promise.timeout(config.ws_conn_timeout, 'connection ws timeout');
            }
            return Q.fcall(function() {return sigSocket;}).timeout(config.ws_conn_timeout, 'connection ws timeout');
        }
    }).then(function() {
        dbg.log0('send ws request to peer for request '+requestId+ ' and peer '+peerId);
        sigSocket.ws.send(JSON.stringify({sigType: options.path, from: sigSocket.idInServer, to: peerId, requestId: requestId, body: options, method: options.method}));

        if (!sigSocket.action_defer) {
            sigSocket.action_defer = {};
        }
        sigSocket.action_defer[requestId] = Q.defer();
        return sigSocket.action_defer[requestId].promise.timeout(timeout || config.response_timeout, 'response ws timeout');
    }).then(function(response) {
        dbg.log0('return response data '+util.inspect(response)+' for request '+requestId+ ' and peer '+peerId);

        if (!isAgent && !p2p_context) {
            ice.closeSignaling(sigSocket);
        } else if (p2p_context) {
            delete p2p_context.wsClientSocket.usedBy[requestId];
        }

        return response;
    }).then(null, function(err) {
        dbg.error('WS REST REQUEST FAILED '+util.inspect(err)+' for request '+requestId+ ' and peer '+peerId);

        if (sigSocket) {
            dbg.log0('close ws socket for request '+requestId+ ' and peer '+peerId);
            ice.closeIce(sigSocket, requestId, null);
        }

        throw err;
    });
};

module.exports.sendRequest = function sendRequest(p2p_context, ws_socket, peerId, request, agentId, buffer, timeout) {
    var iceSocket;
    var sigSocket;
    var requestId;
    var msgObj;

    if (agentId || (ws_socket && ws_socket.isAgent)) {
        isAgent = true;
    }

    return Q.fcall(function() {
        dbg.log3('starting setup for peer '+peerId);

        if (ws_socket) {
            sigSocket = ws_socket;
        } else if (p2p_context && p2p_context.wsClientSocket) {
            sigSocket = p2p_context.wsClientSocket.ws_socket;
        }

        if (!sigSocket) {
            dbg.log0('CREATE NEW WS CONN');
            sigSocket = ice.setup(onIceMessage, agentId);
        }

        if (!isAgent && p2p_context) {
            var interval;
            if (!p2p_context.wsClientSocket) {
                dbg.log3('SET INTERVAL stale ws connection');
                interval = setInterval(function(){staleConnChk(p2p_context);}, config.check_stale_conns);
            } else {
                interval = p2p_context.wsClientSocket.interval;
            }
            p2p_context.wsClientSocket = {ws_socket: sigSocket, lastTimeUsed: new Date().getTime(), interval: interval};
        }

        if (sigSocket.conn_defer) {return sigSocket.conn_defer.promise;}
        return Q.fcall(function() {return sigSocket;});
    }).then(function() {
        requestId = generateRequestId();
        dbg.log0('starting to initiate ice to '+peerId+' request '+requestId);
        return ice.initiateIce(p2p_context, sigSocket, peerId, true, requestId).timeout(config.ice_conn_timeout, 'connection timeout');
    }).then(function(newSocket) {
        iceSocket = newSocket;

        iceSocket.msgs[requestId] = {};
        msgObj = iceSocket.msgs[requestId];

        msgObj.action_defer = Q.defer();

        if (buffer) {
            request.size = buffer.length;
        }
        request.req = requestId;

        dbg.log0('send request ice to '+peerId+' request '+requestId);

        // write has timeout internally
        return writeMessage(sigSocket, iceSocket, request, buffer, requestId);

    }).then(function() {

        dbg.log0('wait for response ice to '+peerId+' request '+requestId);

        return msgObj.action_defer.promise.timeout(timeout || config.response_timeout, 'response timeout');

    }).then(function() {

        msgObj = iceSocket.msgs[requestId];

        dbg.log0('got response ice to '+peerId+' request '+requestId+' resp: '+msgObj);

        var response = msgObj.peer_msg;
        if (msgObj.buffer) {
            dbg.log0('response: '+response+' has buffer ' + Buffer.isBuffer(msgObj.buffer)+' for request '+requestId+ ' and peer '+peerId);
            response.data = msgObj.buffer;
        }

        dbg.log0('close ice socket if needed for request '+requestId+ ' and peer '+peerId);
        ice.closeIce(sigSocket, requestId, iceSocket);

        return response;
    }).then(null, function(err) {
        dbg.error('ice_api.sendRequest ERROR '+err+' for request '+requestId+ ' and peer '+peerId+' stack '+(err ? err.stack : 'N/A')+' inspect '+util.inspect(err));

        if (iceSocket && sigSocket) {
            dbg.log0('close ice socket if needed for request '+requestId+ ' and peer '+peerId);
            ice.closeIce(sigSocket, requestId, iceSocket);
        }

        throw err;
    });
};
