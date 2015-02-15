var ice = require('./ice_lib');
var Q = require('q');
var buf = require('./buffer_utils');
var rand = require('./random_utils');

var handleRequestMethod;

var exports = module.exports = {};

var isAgent;

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

    writeLog('*** got event '+event.data  + " ; my id: "+channel.myId);

    if (typeof event.data == 'string' || event.data instanceof String) {
        try {
            var message = JSON.parse(event.data);

            writeLog('got message '+ message + ' --- from ---' +event.data);

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
            }
        } catch (ex) {
            writeLog('ex on string req ' + ex);
        }
    } else if (event.data instanceof ArrayBuffer) {

        writeLog('got chunk ' + event.data + " size " + event.data.byteLength + " curr " + channel.received_size);
        try {
            if (channel.buffer) {
                channel.buffer = buf.addToBuffer(channel.buffer, event.data);
            } else {
                channel.buffer = buf.toBuffer(event.data);
            }
        } catch (ex) {
            writeLog('err write on got chunk '+ ex.stack +' ex: ' +ex);
        }

        channel.received_size += event.data.byteLength;

        if (channel.received_size === parseInt(channel.msg_size)) {

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
    } else {
        writeLog('WTF got ' + event.data);
    }
}

var chunk_size = 60000;
var writeBufferToSocket = function writeBufferToSocket(channel, block) {
    if (block.byteLength > chunk_size) {
        var begin = 0;
        var end = chunk_size;
        while (end < block.byteLength) {
            channel.send(block.slice(begin, end));
            begin = end;
            end = end + chunk_size;
        }
        channel.send(block.slice(begin));

    } else {
        channel.send(block);
    }
};
exports.writeBufferToSocket = writeBufferToSocket;

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
        } else {
            sigSocket = ice.setup(onIceMessage, agentId);
        }
        if (sigSocket.conn_defer) return sigSocket.conn_defer.promise;
        else return Q.fcall(function() {return sigSocket});
    }).then(function() {
        writeLog('starting to initiate ice '+JSON.stringify(sigSocket));
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
        iceSocket.close();
        ice.closeSignaling(sigSocket);

        var response = channel.peer_msg;
        if (channel.buffer) {
            console.error('---> response: has buffer ' + Buffer.isBuffer(channel.buffer));
            response.data = channel.buffer;
        }

        console.error('---> response: '+response + ' ; ' + require('util').inspect(response));

        return response;
    }).then(null, function(err) {
        console.error('---> ice_api.sendRequest ERROR '+err.stack);
    }).catch(function(err) {
        console.error('---> ice_api.sendRequest FAIL '+err.stack);
    });
};