var ice = require('./ice_lib');
var Q = require('q');
var buf = require('./buffer_utils');
var rand = require('./random_utils');

var handleRequestMethod;

var exports = module.exports = {};

var isAgent;

var chunk_size = 60000;
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
    writeLog('Got event '+event.data+' ; my id: '+channel.myId);

    if (typeof event.data == 'string' || event.data instanceof String) {
        writeLog('got message str '+require('util').inspect(event.data));
        try {
            var message = JSON.parse(event.data);

            writeLog('got message str ' + message + ' --- from --- ' + event.data);

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

            writeLog('got chunk '+part+' with size ' + event.data.byteLength + " total size so far " + channel.received_size);

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
    if (block.byteLength > chunk_size) {
        var begin = 0;
        var end = chunk_size;
        var counter = 0;
        while (end < block.byteLength) {

            channel.send(createBufferToSend(block.slice(begin, end), counter));

            writeLog('send chunk '+counter+ ' size: ' + chunk_size);
            begin = end;
            end = end + chunk_size;
            counter++;
        }
        var bufToSend = block.slice(begin);
        channel.send(createBufferToSend(bufToSend, counter));
        writeLog('send last chunk '+counter+ ' size: ' + bufToSend.byteLength);

    } else {
        writeLog('send chunk all at one, size: '+block.byteLength);
        channel.send(createBufferToSend(block), counter);
    }
};
exports.writeBufferToSocket = writeBufferToSocket;


/********************************
 * handle stale connections
 ********************************/
function staleConnChk() {
    writeLog('BEFORE stale ws connection');
    if (isAgent || !wsClientSocket)
        return;

    writeLog('START chk for stale ws connection to remove - client '+require('util').inspect(wsClientSocket));
    var now = (new Date()).getTime();

    if (now - wsClientSocket.lastTimeUsed > (1*60*1000)) {
        ice.closeSignaling(wsClientSocket.ws_socket);
        clearInterval(wsClientSocket.interval);
        wsClientSocket = null;
    }

    writeLog('AFTER looking for stale ws connection to remove - client '+require('util').inspect(wsClientSocket));
}

exports.sendRequest = function sendRequest(ws_socket, peerId, request, agentId, buffer) {
    var iceSocket;
    var sigSocket;

    if (agentId) {
        isAgent = true;
    }

    return Q.fcall(function() {
        writeLog('starting setup');

        if (ws_socket) {
            sigSocket = ws_socket;
        } else if (wsClientSocket) {
            sigSocket = wsClientSocket.ws_socket;
        }

        if (!sigSocket) {
            writeLog('CREATE NEW CONN');
            sigSocket = ice.setup(onIceMessage, agentId);
        }

        if (!isAgent) {
            var interval;
            if (!wsClientSocket) {
                writeLog('SET INTERVAL stale ws connection');
                interval = setInterval(function(){staleConnChk();}, (1*60*1000));
            } else {
                interval = wsClientSocket.interval;
            }
            wsClientSocket = {ws_socket: sigSocket, lastTimeUsed: new Date().getTime(), interval: interval};
        }

        if (sigSocket.conn_defer) return sigSocket.conn_defer.promise;
        else return Q.fcall(function() {return sigSocket});
    }).then(function() {
        writeLog('starting to initiate ice to '+peerId);
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
        writeLog('close ice socket');
        iceSocket.close();

        var response = channel.peer_msg;
        if (channel.buffer) {
            writeLog('response: has buffer ' + Buffer.isBuffer(channel.buffer));
            response.data = channel.buffer;
        }

        writeLog('response: '+response + ' ; ' + require('util').inspect(response));

        return response;
    }).then(null, function(err) {
        writeLog('ice_api.sendRequest ERROR '+err.stack);
        throw err;
    }).catch(function(err) {
        writeLog('ice_api.sendRequest FAIL '+err.stack);
        throw err;
    });
};