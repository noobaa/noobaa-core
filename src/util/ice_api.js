var ice = require('./ice_lib');
var Q = require('q');
var buf = require('./buffer_utils');
var rand = require('./random_utils');
var dbg = require('../util/dbg')(__filename);
var config = require('../../config.js');

var exports = module.exports = {};

var isAgent;

var partSize = 40;

exports.signalingSetup = function signalingSetup(handleRequestMethodTemp, agentId) {
    if (agentId) {
        isAgent = true;
    }
    return ice.setup(onIceMessage, agentId, handleRequestMethodTemp);
};

function writeLog(msg) {
    if (isAgent) {
        console.error(msg);
    } else {
        console.log(msg);
    }
}

function onIceMessage(channel, event) {
    //dbg.log0('Got event '+event.data+' ; my id: '+channel.myId);

    if (typeof event.data == 'string' || event.data instanceof String) {
        //dbg.log0('got message str '+require('util').inspect(event.data));
        try {
            var message = JSON.parse(event.data);

            dbg.log0('got message str ' + event.data + ' my id '+channel.myId);

            if (!channel.msgs[message.req]) {
                channel.msgs[message.req] = {};
            }
            var msgObj = channel.msgs[message.req];

            msgObj.peer_msg = message;

            if (!message.size || parseInt(message.size) === 0) {

                if (msgObj.action_defer) {
                    msgObj.action_defer.resolve(channel);
                } else {
                    channel.handleRequestMethod(channel, message);
                }
            } else {
                msgObj.msg_size = parseInt(message.size);
                msgObj.received_size = 0;
                msgObj.chunk_num = 0;
                msgObj.chunks_map = {};
            }

        } catch (ex) {
            writeLog('ex on string req ' + ex.stack);
        }
    } else if (event.data instanceof ArrayBuffer) {

        try {
            var bff = buf.toBuffer(event.data);
            var req = ''+bff.readInt32LE(0);
            var part = bff.readInt8(32);

            var msgObj = channel.msgs[req];

            var partBuf = event.data.slice(partSize);
            msgObj.chunks_map[part] = partBuf;

            //dbg.log0('got chunk '+part+' with size ' + event.data.byteLength + " total size so far " + msgObj.received_size);

            msgObj.chunk_num++;

            msgObj.received_size += (event.data.byteLength - partSize);

            if (msgObj.received_size === msgObj.msg_size) {

                dbg.log0('all chunks received last '+part+' with size ' +
                event.data.byteLength + " total size so far " + msgObj.received_size
                + ' my id '+channel.myId);

                var chunksParts = [];
                for (var i = 0; i < msgObj.chunk_num; ++i) {
                    chunksParts.push(buf.toBuffer(msgObj.chunks_map[i]));
                }
                msgObj.buffer = Buffer.concat(chunksParts, msgObj.msg_size);

                if (msgObj.action_defer) {
                    msgObj.action_defer.resolve(channel);
                } else {
                    try {
                        channel.handleRequestMethod(channel, event.data);
                    } catch (ex) {
                        writeLog('ex on ArrayBuffer req ' + ex);
                    }
                }
            }
        } catch (ex) {
            writeLog('ex on ab got ' + ex.stack);
        }
    } else {
        writeLog('WTF got ' + event.data);
    }
}

function createBufferToSend(block, seq, reqId) {
    var bufToSend = new Buffer(partSize);
    try {reqId = parseInt(reqId, 10);}  catch (ex){console.error('fail parse req id '+ex);}
    bufToSend.writeInt32LE(reqId,0);
    bufToSend.writeInt8(seq,32);
    bufToSend = buf.addToBuffer(bufToSend, block);
    return buf.toArrayBuffer(bufToSend);
}

var writeBufferToSocket = function writeBufferToSocket(channel, block, reqId) {
    var counter = 0;
    if (block.byteLength > config.chunk_size) {
        var begin = 0;
        var end = config.chunk_size;

        while (end < block.byteLength) {
            channel.send(createBufferToSend(block.slice(begin, end), counter, reqId));
            //dbg.log0('send chunk '+counter+ ' size: ' + config.chunk_size);
            begin = end;
            end = end + config.chunk_size;
            counter++;
        }
        var bufToSend = block.slice(begin);
        channel.send(createBufferToSend(bufToSend, counter, reqId));
        dbg.log0('send last chunk '+counter+ ' size: ' + bufToSend.byteLength);

    } else {
        dbg.log0('send chunk all at one, size: '+block.byteLength);
        channel.send(createBufferToSend(block, counter, reqId));
    }
};
exports.writeBufferToSocket = writeBufferToSocket;


/********************************
 * handle stale connections
 ********************************/
function staleConnChk(p2p_context) {
    if (isAgent || !p2p_context || !p2p_context.wsClientSocket)
        return;

    var now = (new Date()).getTime();

    if (now - p2p_context.wsClientSocket.lastTimeUsed > config.connection_data_stale) {
        dbg.log0('REMOVE stale ws connection to remove - client as '+require('util').inspect(p2p_context.wsClientSocket.ws_socket.idInServer));
        ice.closeSignaling(p2p_context.wsClientSocket.ws_socket);
        clearInterval(p2p_context.wsClientSocket.interval);
        p2p_context.wsClientSocket = null;
    }
}

exports.sendWSRequest = function sendWSRequest(p2p_context, peerId, options) {

    var sigSocket;
    return Q.fcall(function() {

        if (p2p_context && p2p_context.wsClientSocket) {
            sigSocket = p2p_context.wsClientSocket.ws_socket;
        }

        if (!sigSocket) {
            dbg.log0('CREATE NEW WS CONN');
            var prob = function(channel, event) {
                console.error('ERROR Should never receive ice msgs ! got: '+event.data);};
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

        if (sigSocket.conn_defer) return sigSocket.conn_defer.promise;
        else return Q.fcall(function() {return sigSocket});
    }).then(function(wsSocket) {
        var requestId = generateRequestId();
        sigSocket.ws.send(JSON.stringify({sigType: options.path, from: sigSocket.idInServer, to: peerId, requestId: requestId, body: options, method: options.method}));

        if (!sigSocket.action_defer) {
            sigSocket.action_defer = {};
        }
        sigSocket.action_defer[requestId] = Q.defer();
        return sigSocket.action_defer[requestId].promise;
    }).then(function(response) {
        dbg.log3('return response data '+require('util').inspect(response));
        return response;
    }).then(null, function(err) {
        console.error('WS REST REQUEST FAILED '+err);
        throw err;
    });
};

function generateRequestId() {
    return ''+rand.getRandomInt(10000,90000);
}

var timeToIce = 0;
var timeWithSend = 0;
var tries = 0;
exports.sendRequest = function sendRequest(p2p_context, ws_socket, peerId, request, agentId, buffer) {
    var iceSocket;
    var sigSocket;

    if (agentId || (ws_socket && ws_socket.isAgent)) {
        isAgent = true;
    }

    tries++;
    var start = new Date().getTime();
    var requestId;

    return Q.fcall(function() {
        dbg.log0('starting setup');

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
                dbg.log0('SET INTERVAL stale ws connection');
                interval = setInterval(function(){staleConnChk(p2p_context);}, config.check_stale_conns);
            } else {
                interval = p2p_context.wsClientSocket.interval;
            }
            p2p_context.wsClientSocket = {ws_socket: sigSocket, lastTimeUsed: new Date().getTime(), interval: interval};
        }

        if (sigSocket.conn_defer) return sigSocket.conn_defer.promise;
        else return Q.fcall(function() {return sigSocket});
    }).then(function() {
        dbg.log0('starting to initiate ice to '+peerId);
        requestId = generateRequestId();
        return ice.initiateIce(p2p_context, sigSocket, peerId, true, requestId);
    }).then(function(newSocket) {
        iceSocket = newSocket;

        iceSocket.msgs[requestId] = {};
        msgObj = iceSocket.msgs[requestId];

        msgObj.action_defer = Q.defer();

        var end = new Date().getTime();
        timeToIce += (end - start);

        if (buffer) {
            request.size = buffer.byteLength;
        }
        request.req = requestId;

        iceSocket.send(JSON.stringify(request));

        if (buffer) {
            writeBufferToSocket(iceSocket, buffer, requestId);
        }

        return msgObj.action_defer.promise;
    }).then(function(channel) {

        msgObj = iceSocket.msgs[requestId];

        var response = msgObj.peer_msg;
        if (msgObj.buffer) {
            dbg.log0('response: '+response+' has buffer ' + Buffer.isBuffer(msgObj.buffer));
            response.data = msgObj.buffer;
        }

        var end2 = new Date().getTime();
        timeWithSend += (end2 - start);

        console.error('$%$#%$# time ice: '+(timeToIce/1000) + ' sec and time with send '+(timeWithSend/1000) + ' for tries: '+tries);

        dbg.log0('close ice socket');
        ice.closeIce(sigSocket, requestId, iceSocket);

        return response;
    }).then(null, function(err) {
        writeLog('ice_api.sendRequest ERROR '+err);
        throw err;
    }).catch(function(err) {
        writeLog('ice_api.sendRequest FAIL '+err);
        throw err;
    });
};