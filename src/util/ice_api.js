var ice = require('./ice_lib');
var Q = require('q');
var buf = require('./buffer_utils');
var rand = require('./random_utils');

var handleRequestMethod;

var exports = module.exports = {};

exports.signalingSetup = function signalingSetup(handleRequestMethodTemp, agentId) {
    handleRequestMethod = handleRequestMethodTemp;
    return ice.setup(onIceMessage, agentId);
};

function onIceMessage(channel, event) {

    console.log('*** got event '+event.data);

    if (typeof event.data == 'string' || event.data instanceof String) {
        try {
            var message = JSON.parse(event.data);

            console.log('got message '+ message + ' --- from ---' +event.data);

            channel.peer_msg = message;

            if (!message.size || parseInt(message.size) === 0) {

                if (channel.action_defer) {
                    channel.action_defer.resolve(message);
                } else {
                    handleRequestMethod(channel, message);
                }
            } else {
                channel.msg_size = parseInt(message.size);
                channel.received_size = 0;
            }
        } catch (ex) {
            console.log('ex on string req ' + ex);
        }
    } else if (event.data instanceof ArrayBuffer) {

        console.log('got chunk ' + event.data + " size " + event.data.byteLength + " curr " + channel.received_size);
        try {
            if (channel.buffer) {
                channel.buffer = buf.addToBuffer(channel.buffer, event.data);
            } else {
                channel.buffer = buf.toBuffer(event.data);
            }
        } catch (ex) {
            console.log('err write on got chunk '+ ex.stack +' ex: ' +ex);
        }

        channel.received_size += event.data.byteLength;

        if (channel.received_size === parseInt(channel.msg_size)) {

            if (channel.action_defer) {
                channel.action_defer.resolve(channel.buffer);
            } else {
                handleRequestMethod(channel, event.data);
            }
        }
    } else {
        console.log('WTF got ' + event.data);
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

    return Q.fcall(function() {
        console.log('starting setup');
        if (ws_socket) {
            sigSocket = ws_socket;
        } else {
            sigSocket = ice.setup(onIceMessage, agentId);
        }
        if (sigSocket.ws.conn_defer) return sigSocket.ws.conn_defer.promise;
        else return Q.fcall(function() {return sigSocket});
    }).then(function() {
        console.log('starting to initiate ice '+JSON.stringify(sigSocket));
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
    }).then(function(response) {
        iceSocket.close();
        ice.closeSignaling(sigSocket);
        return response;
    }).then(null, function(err) {
        console.log('---> query ERROR '+err.stack);
    }).catch(function(err) {
        console.log('---> onIceMessage FAIL '+err.stack);
    });
};