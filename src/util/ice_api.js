var ice = require('./ice_lib');
var Q = require('q');
var buf = require('./buffer_utils');
var rand = require('./random_utils');

var handleRequestMethod;

var exports = module.exports = {};

var isAgent;

var chunk_size = 60000;

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
    writeLog('*** got event '+ event.data  + " ; my id: "+channel.myId);

    if (typeof event.data == 'string' || event.data instanceof String) {
        writeLog('got message str '+require('util').inspect(event.data));
        try {
            var message = JSON.parse(event.data);

            if (message.chunk_num && message.message instanceof ArrayBuffer) {
                writeLog('got message ab '+ message + ' --- from ---' +event.data);

                handleArrayInObject(channel, message);
            } else {
                writeLog('got message str ' + message + ' --- from ---' + event.data);

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
                    channel.arrayToStoreChunks = [];
                }
            }
        } catch (ex) {
            writeLog('ex on string req ' + ex.stack);
        }
    } else if (event.data instanceof ArrayBuffer) {

        var bff = buf.toBuffer(event.data);
        console.error('%%%% got chunk '+channel.chunk_num+' starts with '+ bff[0]+','+bff[1]+','+bff[2]);

        writeLog('got chunk ' + event.data + " size " + event.data.byteLength + " curr " + channel.received_size);

        if (event.data.byteLength < chunk_size) {
            writeLog('got last chunk as '+channel.chunk_num);
            channel.last_part = event.data;
        } else {
            channel.arrayToStoreChunks.push(event.data);
        }

        channel.chunk_num++;

        channel.received_size += event.data.byteLength;

        if (channel.received_size === parseInt(channel.msg_size)) {

            for (var i = 0; i < channel.chunk_num - 1; ++i) {
                if (channel.buffer) {
                    channel.buffer = buf.addToBuffer(channel.buffer, channel.arrayToStoreChunks[i]);
                } else {
                    channel.buffer = buf.toBuffer(channel.arrayToStoreChunks[i]);
                }
            }

            if (channel.buffer) {
                channel.buffer = buf.addToBuffer(channel.buffer, channel.last_part);
            } else {
                channel.buffer = buf.toBuffer(channel.last_part);
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
    } else {
        writeLog('WTF got ' + event.data);
    }
}

var writeBufferToSocket = function writeBufferToSocket(channel, block) {
    var bff;
    if (block.byteLength > chunk_size) {
        var begin = 0;
        var end = chunk_size;
        var counter = 0;
        while (end < block.byteLength) {

            channel.send(block.slice(begin, end));

            bff = buf.toBuffer(block.slice(begin, end));
            console.error('%%%% send chunk '+counter+ ' begin at:' + begin+' starts with '+ bff[0]+','+bff[1]+','+bff[2]);
            begin = end;
            end = end + chunk_size;
            counter++;
        }

        channel.send(block.slice(begin));
        bff = buf.toBuffer(block.slice(begin));
        console.error('%%%% send last chunk '+counter+ ' begin at:' + begin+' starts with '+ bff[0]+','+bff[1]+','+bff[2]);

    } else {
        console.error('%%%% send chunk all at one');
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