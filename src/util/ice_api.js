'use strict';

var ice = require('./ice_lib');
var Q = require('q');
var buf = require('./buffer_utils');
var rand = require('./random_utils');
var dbg = require('../util/dbg')(__filename);
var config = require('../../config.js');

module.exports = {};

var isAgent;

var partSize = 40;

function writeLog(msg) {
    if (isAgent) {
        console.error(msg);
    } else {
        console.log(msg);
    }
}

var onIceMessage = function onIceMessage(p2p_context, channel, event) {
    dbg.log2('Got event '+event.data+' ; my id: '+channel.myId);
    var msgObj;
    var req;

    if (typeof event.data === 'string' || event.data instanceof String) {
        try {
            var message = JSON.parse(event.data);
            req = message.req;

            dbg.log0('got message str ' + event.data + ' my id '+channel.myId);

            if (!channel.msgs[message.req]) {
                channel.msgs[message.req] = {};
            }
            msgObj = channel.msgs[message.req];

            msgObj.peer_msg = message;

            if (!message.size || parseInt(message.size, 10) === 0) {

                if (msgObj.action_defer) {
                    dbg.log3('message str set action defer resolve for req '+message.req);
                    msgObj.action_defer.resolve(channel);
                } else {
                    dbg.log2('message str call handleRequestMethod resolve for req '+message.req+' to '+channel.handleRequestMethod); // TODO REM
                    channel.handleRequestMethod(channel, message);
                }
            } else {
                msgObj.msg_size = parseInt(message.size, 10);
                msgObj.received_size = 0;
                msgObj.chunk_num = 0;
                msgObj.chunks_map = {};
            }

        } catch (ex) {
            writeLog('ex on string req ' + ex + ' ; ' + ex.stack+' for req '+req);
        }
    } else if (event.data instanceof ArrayBuffer) {

        try {
            var bff = buf.toBuffer(event.data);
            req = (bff.readInt32LE(0)).toString();
            var part = bff.readInt8(32);

            msgObj = channel.msgs[req];

            var partBuf = event.data.slice(partSize);
            msgObj.chunks_map[part] = partBuf;

            dbg.log3('got chunk '+part+' with size ' + event.data.byteLength + " total size so far " + msgObj.received_size+' req '+req);

            msgObj.chunk_num++;

            msgObj.received_size += (event.data.byteLength - partSize);

            if (msgObj.received_size === msgObj.msg_size) {

                dbg.log0('all chunks received last '+part+' with size ' +
                event.data.byteLength + " total size so far " + msgObj.received_size
                + ' my id '+channel.myId+ ' request '+req);

                var chunksParts = [];
                var chunk_counter;
                for (chunk_counter = 0; chunk_counter < msgObj.chunk_num; ++chunk_counter) {
                    chunksParts.push(buf.toBuffer(msgObj.chunks_map[chunk_counter]));
                }
                msgObj.buffer = Buffer.concat(chunksParts, msgObj.msg_size);

                if (msgObj.action_defer) {
                    dbg.log3('ab set action defer resolve for req '+req);
                    msgObj.action_defer.resolve(channel);
                } else {
                    try {
                        dbg.log3('ab call handleRequestMethod resolve for req '+req);
                        channel.handleRequestMethod(channel, event.data);
                    } catch (ex) {
                        writeLog('ex on ArrayBuffer req ' + ex+' for req '+req);
                    }
                }
            }
        } catch (ex) {
            writeLog('ex on ab got ' + ex.stack+' for req '+req+' and msg '+Object.keys(channel.msgs));
        }
    } else {
        writeLog('WTF got ' + event.data);
    }
};
module.exports.onIceMessage = onIceMessage;

module.exports.signalingSetup = function signalingSetup(handleRequestMethodTemp, agentId) {
    if (agentId) {
        isAgent = true;
    }
    return ice.setup(onIceMessage, agentId, handleRequestMethodTemp);
};

var createBufferToSend = function createBufferToSend(block, seq, reqId) {
    var bufToSend = new Buffer(partSize);
    try {reqId = parseInt(reqId, 10);}  catch (ex){console.error('fail parse req id '+ex);}
    bufToSend.writeInt32LE(reqId,0);
    bufToSend.writeInt8(seq,32);
    bufToSend = buf.addToBuffer(bufToSend, block);
    return buf.toArrayBuffer(bufToSend);
};
module.exports.createBufferToSend = createBufferToSend;

function generateRequestId() {
    return rand.getRandomInt(10000,90000).toString();
}

var writeBufferToSocket = function writeBufferToSocket(channel, block, reqId) {
    var counter = 0;
    if (block.byteLength > config.chunk_size) {
        var begin = 0;
        var end = config.chunk_size;

        while (end < block.byteLength) {
            channel.send(createBufferToSend(block.slice(begin, end), counter, reqId));
            dbg.log3('send chunk '+counter+ ' size: ' + config.chunk_size+' req '+reqId);
            begin = end;
            end = end + config.chunk_size;
            counter++;
        }
        var bufToSend = block.slice(begin);
        channel.send(createBufferToSend(bufToSend, counter, reqId));
        dbg.log0('send last chunk '+counter+ ' size: ' + bufToSend.byteLength+' req '+reqId);

    } else {
        dbg.log0('send chunk all at one, size: '+block.byteLength+' req '+reqId);
        channel.send(createBufferToSend(block, counter, reqId));
    }
};
module.exports.writeBufferToSocket = writeBufferToSocket;


/********************************
 * handle stale connections
 ********************************/
function staleConnChk(p2p_context) {
    if (isAgent || !p2p_context || !p2p_context.wsClientSocket) {
        return;
    }

    var now = (new Date()).getTime();

    if (now - p2p_context.wsClientSocket.lastTimeUsed > config.connection_data_stale) {
        dbg.log0('REMOVE stale ws connection to remove - client as '+require('util').inspect(p2p_context.wsClientSocket.ws_socket.idInServer));
        ice.closeSignaling(p2p_context.wsClientSocket.ws_socket);
        clearInterval(p2p_context.wsClientSocket.interval);
        p2p_context.wsClientSocket = null;
    }
}

module.exports.sendWSRequest = function sendWSRequest(p2p_context, peerId, options, timeout) {

    var sigSocket;
    var requestId;

    if (!timeout) {
        timeout = config.connection_default_timeout;
    }

    return Q.fcall(function() {

        if (p2p_context && p2p_context.wsClientSocket) {
            sigSocket = p2p_context.wsClientSocket.ws_socket;
        }

        if (!sigSocket) {
            dbg.log0('CREATE NEW WS CONN');
            var prob = function(channel, event) {
                console.error('ERROR Should never receive ice msgs ! got: '+event.data+' from '+channel.peerId);};
            sigSocket = ice.setup(prob, null, prob);
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

        if (sigSocket.conn_defer) {
            return sigSocket.conn_defer.promise;
        }
        return Q.fcall(function() {return sigSocket;});

    }).timeout(timeout).then(function() {
        requestId = generateRequestId();
        dbg.log0('send ws request too peer for request '+requestId+ ' and peer '+peerId);
        sigSocket.ws.send(JSON.stringify({sigType: options.path, from: sigSocket.idInServer, to: peerId, requestId: requestId, body: options, method: options.method}));

        if (!sigSocket.action_defer) {
            sigSocket.action_defer = {};
        }
        sigSocket.action_defer[requestId] = Q.defer();
        return sigSocket.action_defer[requestId].promise;
    }).timeout(config.get_response_default_timeout).then(function(response) {
        dbg.log0('return response data '+require('util').inspect(response)+' for request '+requestId+ ' and peer '+peerId);
        return response;
    }).then(null, function(err) {
        console.error('WS REST REQUEST FAILED '+err+' for request '+requestId+ ' and peer '+peerId);

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

    if (agentId || (ws_socket && ws_socket.isAgent)) {
        isAgent = true;
    }

    if (!timeout) {
        timeout = config.connection_default_timeout;
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
    }).timeout(timeout).then(function() {
        requestId = generateRequestId();
        dbg.log0('starting to initiate ice to '+peerId+' request '+requestId);
        return ice.initiateIce(p2p_context, sigSocket, peerId, true, requestId);
    }).timeout(timeout).then(function(newSocket) {
        iceSocket = newSocket;

        iceSocket.msgs[requestId] = {};
        var msgObj = iceSocket.msgs[requestId];

        msgObj.action_defer = Q.defer();

        if (buffer) {
            request.size = buffer.byteLength;
        }
        request.req = requestId;

        dbg.log0('send request ice to '+peerId+' request '+requestId);

        iceSocket.send(JSON.stringify(request));

        if (buffer) {
            writeBufferToSocket(iceSocket, buffer, requestId);
        }

        dbg.log0('wait for response ice to '+peerId+' request '+requestId);

        return msgObj.action_defer.promise;
    }).timeout(config.get_response_default_timeout).then(function() {

        var msgObj = iceSocket.msgs[requestId];

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
        console.error('ice_api.sendRequest ERROR '+err+' for request '+requestId+ ' and peer '+peerId);

        if (iceSocket && sigSocket) {
            dbg.log0('close ice socket if needed for request '+requestId+ ' and peer '+peerId);
            ice.closeIce(sigSocket, requestId, iceSocket);
        }

        throw err;
    });
};