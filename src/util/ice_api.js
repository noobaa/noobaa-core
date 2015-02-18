var ice = require('./ice_lib');
var Q = require('q');
var buf = require('./buffer_utils');
var rand = require('./random_utils');
var dbg = require('../util/dbg')(__filename);
var config = require('../../config.js');

var handleRequestMethod;

var exports = module.exports = {};

var isAgent;

var partSize = 8;

var wsClientSocket;

exports.signalingSetup = function signalingSetup(handleRequestMethodTemp, agentId) {
    handleRequestMethod = handleRequestMethodTemp;
    if (agentId) {
        isAgent = true;
    }
    return ice.setup(onIceMessage, agentId);
};

function writeLog(msg) {
    if (isAgent) {
        console.error(msg);
    } else {
        console.log(msg);
    }
}

function onIceMessage(channel, event) {
    dbg.log0('Got event '+event.data+' ; my id: '+channel.myId);

    if (typeof event.data == 'string' || event.data instanceof String) {
        dbg.log0('got message str '+require('util').inspect(event.data));
        try {
            var message = JSON.parse(event.data);

            dbg.log0('got message str ' + message + ' --- from --- ' + event.data);

            channel.peer_msg = message;

            if (!message.size || parseInt(message.size) === 0) {

                if (channel.action_defer) {
                    channel.action_defer.resolve(channel);
                } else {
                    handleRequestMethod(channel, message);
                }
            } else {
                channel.msg_size = parseInt(message.size);
                channel.received_size = 0;
                channel.chunk_num = 0;
                channel.chunks_map = {};
            }

        } catch (ex) {
            writeLog('ex on string req ' + ex.stack);
        }
    } else if (event.data instanceof ArrayBuffer) {

        try {
            var bff = buf.toBuffer(event.data);
            var part = bff.readInt8(0);
            channel.chunks_map[part] = event.data.slice(partSize);

            dbg.log0('got chunk '+part+' with size ' + event.data.byteLength + " total size so far " + channel.received_size);

            channel.chunk_num++;

            channel.received_size += (event.data.byteLength - partSize);

            if (channel.received_size === parseInt(channel.msg_size)) {

                for (var i = 0; i < channel.chunk_num; ++i) {
                    if (channel.buffer) {
                        channel.buffer = buf.addToBuffer(channel.buffer, channel.chunks_map[i]);
                    } else {
                        channel.buffer = buf.toBuffer(channel.chunks_map[i]);
                    }
                }

                if (channel.action_defer) {
                    channel.action_defer.resolve(channel);
                } else {
                    try {
                        handleRequestMethod(channel, event.data);
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

function createBufferToSend(block, seq) {
    var bufToSend = new Buffer(partSize);
    bufToSend.writeInt8(seq);
    bufToSend = buf.addToBuffer(bufToSend, block);
    return buf.toArrayBuffer(bufToSend);
}

var writeBufferToSocket = function writeBufferToSocket(channel, block) {
    var counter = 0;
    if (block.byteLength > config.chunk_size) {
        var begin = 0;
        var end = config.chunk_size;

        while (end < block.byteLength) {
            channel.send(createBufferToSend(block.slice(begin, end), counter));
            dbg.log0('send chunk '+counter+ ' size: ' + config.chunk_size);
            begin = end;
            end = end + config.chunk_size;
            counter++;
        }
        var bufToSend = block.slice(begin);
        channel.send(createBufferToSend(bufToSend, counter));
        dbg.log0('send last chunk '+counter+ ' size: ' + bufToSend.byteLength);

    } else {
        dbg.log0('send chunk all at one, size: '+block.byteLength);
        channel.send(createBufferToSend(block, counter));
    }
};
exports.writeBufferToSocket = writeBufferToSocket;


/********************************
 * handle stale connections
 ********************************/
function staleConnChk() {
    dbg.log0('BEFORE stale ws connection');
    if (isAgent || !wsClientSocket)
        return;

    dbg.log0('START chk for stale ws connection to remove - client '+require('util').inspect(wsClientSocket));
    var now = (new Date()).getTime();

    if (now - wsClientSocket.lastTimeUsed > config.connection_data_stale) {
        ice.closeSignaling(wsClientSocket.ws_socket);
        clearInterval(wsClientSocket.interval);
        wsClientSocket = null;
    }

    dbg.log0('AFTER looking for stale ws connection to remove - client '+require('util').inspect(wsClientSocket));
}

exports.sendRequest = function sendRequest(ws_socket, peerId, request, agentId, buffer) {
    var iceSocket;
    var sigSocket;

    if (agentId || (ws_socket && ws_socket.isAgent)) {
        isAgent = true;
    }

    return Q.fcall(function() {
        dbg.log0('starting setup');

        if (ws_socket) {
            sigSocket = ws_socket;
        } else if (wsClientSocket) {
            sigSocket = wsClientSocket.ws_socket;
        }

        if (!sigSocket) {
            dbg.log0('CREATE NEW WS CONN');
            sigSocket = ice.setup(onIceMessage, agentId);
        }

        if (!isAgent) {
            var interval;
            if (!wsClientSocket) {
                dbg.log0('SET INTERVAL stale ws connection');
                interval = setInterval(function(){staleConnChk();}, config.check_stale_conns);
            } else {
                interval = wsClientSocket.interval;
            }
            wsClientSocket = {ws_socket: sigSocket, lastTimeUsed: new Date().getTime(), interval: interval};
        }

        if (sigSocket.conn_defer) return sigSocket.conn_defer.promise;
        else return Q.fcall(function() {return sigSocket});
    }).then(function() {
        dbg.log0('starting to initiate ice to '+peerId);
        var requestId = 'req-' + rand.getRandomInt(10000,90000) + "-end";
        return ice.initiateIce(sigSocket, peerId, true, requestId);
    }).then(function(newSocket) {
        iceSocket = newSocket;
        iceSocket.action_defer = Q.defer();

        if (buffer) {
            request.size = buffer.byteLength;
        }

        iceSocket.send(JSON.stringify(request));

        if (buffer) {
            writeBufferToSocket(iceSocket, buffer);
        }

        return iceSocket.action_defer.promise;
    }).then(function(channel) {
        dbg.log0('close ice socket');
        iceSocket.close();

        var response = channel.peer_msg;
        if (channel.buffer) {
            dbg.log0('response: '+response+' has buffer ' + Buffer.isBuffer(channel.buffer));
            response.data = channel.buffer;
        }

        return response;
    }).then(null, function(err) {
        writeLog('ice_api.sendRequest ERROR '+err.stack);
        throw err;
    }).catch(function(err) {
        writeLog('ice_api.sendRequest FAIL '+err.stack);
        throw err;
    });
};