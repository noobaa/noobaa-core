'use strict';

var ice = require('./ice_lib');
var Q = require('q');
var buf = require('./buffer_utils');
var rand = require('./random_utils');
var dbg = require('noobaa-util/debug_module')(__filename);
var config = require('../../config.js');
var Semaphore = require('noobaa-util/semaphore');

function writeToLog(level, msg) {
    var timeStr = '';
    if (level === 0) {
        dbg.log0(timeStr+' '+msg);
    } else if (level === 1) {
        dbg.log1(timeStr+' '+msg);
    } else if (level === 2) {
        dbg.log2(timeStr+' '+msg);
    } else if (level === 3) {
        dbg.log3(timeStr+' '+msg);
    } else {
        timeStr = (new Date()).toString();
        console.error(timeStr+' '+msg);
    }
}

module.exports = {};

var isAgent;

function forceCloseIce(p2p_context, peerId) {

    var sigSocket;
    if (p2p_context && p2p_context.wsClientSocket) {
        sigSocket = p2p_context.wsClientSocket.ws_socket;
    }

    ice.forceCloseIce(p2p_context, peerId, null, sigSocket);
}
module.exports.forceCloseIce = forceCloseIce;

function onIceMessage(p2p_context, channel, event) {
    writeToLog(3, 'Got event '+event.data+' ; my id: '+channel.myId);
    var msgObj;
    var req;

    if (typeof event.data === 'string' || event.data instanceof String) {
        try {
            var message = JSON.parse(event.data);
            req = message.req;

            if (req === config.junkRequestId) {
                writeToLog(0,'got junkRequestId IGNORE');
                return;
            }
            if (ice.isRequestEnded(p2p_context, req, channel)) {
                writeToLog(0,'got message str ' + event.data + ' my id '+channel.myId+' REQUEST DONE IGNORE');
                return;
            }

            writeToLog(0,'got message str ' + event.data + ' my id '+channel.myId);

            if (!channel.msgs[message.req]) {
                channel.msgs[message.req] = {};
            }
            msgObj = channel.msgs[message.req];

            msgObj.peer_msg = message;

            if (!message.size || parseInt(message.size, 10) === 0) {
                if (msgObj.action_defer) {
                    writeToLog(3,'message str set action defer resolve for req '+message.req);
                    msgObj.action_defer.resolve(channel);
                } else if (channel.handleRequestMethod) {
                    writeToLog(3,'message str call handleRequestMethod resolve for req '+message.req+' to '+channel.handleRequestMethod); // TODO cng to dbg3
                    channel.handleRequestMethod(channel, message);
                } else {
                    writeToLog(2,'ab NO 1 to call for req '+req);
                }
            } else {
                msgObj.msg_size = parseInt(message.size, 10);
            }

        } catch (ex) {
            writeToLog(-1, 'ex on string req ' + ex + ' ; ' + ex.stack+' for req '+req);
        }
    } else if (event.data instanceof ArrayBuffer) {

        try {
            var bff = buf.toBuffer(event.data);
            req = (bff.readInt32LE(0)).toString();
            var part = bff.readInt8(32);

            if (req === config.junkRequestId) {
                writeToLog(0,'got junkRequestId IGNORE');
                return;
            }
            if (ice.isRequestEnded(p2p_context, req, channel)) {
                writeToLog(0,'got message str ' + event.data + ' my id '+channel.myId+' REQUEST DONE IGNORE');
                return;
            }

            if (!channel.msgs[req]) {
                channel.msgs[req] = {};
            }

            msgObj = channel.msgs[req];

            if (!msgObj.received_size) {
                msgObj.received_size = 0;
            }
            if (!msgObj.chunk_num) {
                msgObj.chunk_num = 0;
            }
            if (!msgObj.chunks_map) {
                msgObj.chunks_map = {};
            }

            var partBuf = event.data.slice(config.iceBufferMetaPartSize);
            msgObj.chunks_map[part] = partBuf;

            writeToLog(3,'got chunk '+part+' with size ' + event.data.byteLength + " total size so far " + msgObj.received_size+' req '+req);

            msgObj.chunk_num++;

            msgObj.received_size += (event.data.byteLength - config.iceBufferMetaPartSize);

            if (msgObj.msg_size && msgObj.received_size === msgObj.msg_size) {

                writeToLog(0,'all chunks received last '+part+' with size ' +
                event.data.byteLength + " total size so far " + msgObj.received_size +
                ' my id '+channel.myId+ ' request '+req);

                var chunksParts = [];
                var chunk_counter;
                for (chunk_counter = 0; chunk_counter < msgObj.chunk_num; ++chunk_counter) {
                    chunksParts.push(buf.toBuffer(msgObj.chunks_map[chunk_counter]));
                }
                msgObj.buffer = Buffer.concat(chunksParts, msgObj.msg_size);

                if (msgObj.action_defer) {
                    writeToLog(3,'ab set action defer resolve for req '+req);
                    msgObj.action_defer.resolve(channel);
                } else if (channel.handleRequestMethod) {
                    try {
                        writeToLog(3,'ab call handleRequestMethod resolve for req '+req);
                        channel.handleRequestMethod(channel, event.data);
                    } catch (ex) {
                        writeToLog(-1,'ex on ArrayBuffer req ' + ex+' for req '+req);
                    }
                } else {
                    writeToLog(2,'ab NO 1 to call for req '+req);
                }
            }
        } catch (ex) {
            writeToLog(-1,'ex on ab got ' + ex.stack+' for req '+req+' and msg '+(channel && channel.msgs ? Object.keys(channel.msgs) : 'N/A'));
        }
    } else {
        writeToLog(-1,'WTF got ' + event.data);
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

function writeBufferToSocket(channel, block, reqId) {

    var sequence = 0;
    var begin = 0;
    var end = config.chunk_size;
    if (end > block.byteLength) {
        end = block.byteLength;
    }

    // define the loop func
    function send_next() { // https://noobaa-alpha.herokuapp.com:443

        writeToLog(3,'send_next req '+reqId+' chunks '+sequence+' begin '+begin+' end '+end);

        // end recursion when done sending the entire buffer
        if (begin === end) {
            writeToLog(0,'sent last chunk req '+reqId+' chunks '+sequence);
            var currentBufferSize = channel.bufferedAmount;
            setTimeout(function() {
                ice.handleFlush(channel, currentBufferSize, reqId);
            }, config.timeoutToFlush);

            return;
        }

        // slice the current chunk
        var chunk = ice.createBufferToSend(block.slice(begin, end), sequence, reqId);

        // increment sequence and slice buffer to rest of data
        sequence += 1;
        begin = end;
        end = end + config.chunk_size;
        if (end > block.byteLength) {
            end = block.byteLength;
        }

        // send and recurse
        ice.chkChannelState(channel, reqId);
        writeToLog(3,'sent chunk req '+reqId+' chunk '+sequence+' '+chunk.byteLength);
        return Q.fcall(function() {
            channel.send(chunk);
        })
        .then(send_next)
        .then(null, function(err) {
            writeToLog(-1, 'send_next recur err '+err+' '+err.stack);
            throw err;
        });
    }

    // start sending (recursive async loop)
    return Q.fcall(send_next)
        .then(null, function(err) {
            writeToLog(-1, 'send_next general err '+err+' '+err.stack);
            throw err;
        });

}
module.exports.writeBufferToSocket = writeBufferToSocket;


/********************************
 * handle stale connections
 ********************************/
function staleConnChk(p2p_context) {

    if (!config.doStaleCheck) {
        return;
    }

    if (isAgent || !p2p_context || !p2p_context.wsClientSocket) {
        return;
    }

    writeToLog(2,'RUNNING staleConnChk WS');

    var now = (new Date()).getTime();
    var timePassed = now - p2p_context.wsClientSocket.lastTimeUsed;

    if (timePassed > config.connection_data_stale) {
        writeToLog(0,'REMOVE stale ws connection to remove - client as '+require('util').inspect(p2p_context.wsClientSocket.ws_socket.idInServer));
        ice.closeSignaling(p2p_context.wsClientSocket.ws_socket);
        clearInterval(p2p_context.wsClientSocket.interval);
        p2p_context.wsClientSocket = null;
    }
}

function createNewWS() {
    var prob = function(channel, event) {
        console.error('ERROR Should never receive ice msgs ! got: '+event.data+' from '+channel.peerId);};
    return ice.setup(prob, null, prob);
}

module.exports.sendWSRequest = function sendWSRequest(p2p_context, peerId, options, timeout) {

    var sigSocket;
    var interval;
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
                        p2p_context.wsClientSocket = {ws_socket: sigSocket, lastTimeUsed: new Date().getTime(), interval: interval};
                    }
                } else {
                    writeToLog(0,'CREATE NEW WS CONN (with context) - peer '+peerId+' req '+requestId);
                    sigSocket = createNewWS();
                    if (!isAgent) {
                        interval = setInterval(function(){staleConnChk(p2p_context);}, config.check_stale_conns);
                        p2p_context.wsClientSocket = {ws_socket: sigSocket, lastTimeUsed: new Date().getTime(), interval: interval};
                    }
                }
                if (sigSocket.conn_defer) {
                    return sigSocket.conn_defer.promise;
                }
                return Q.fcall(function() {return sigSocket;});
            });
        } else {
            writeToLog(0,'CREATE NEW WS CONN (no context) - peer '+peerId+' req '+requestId);
            sigSocket = createNewWS();

            if (sigSocket.conn_defer) {
                return sigSocket.conn_defer.promise;
            }
            return Q.fcall(function() {return sigSocket;});
        }
    }).then(function() {
        writeToLog(0,'send ws request to peer for request '+requestId+ ' and peer '+peerId);
        sigSocket.ws.send(JSON.stringify({sigType: options.path, from: sigSocket.idInServer, to: peerId, requestId: requestId, body: options, method: options.method}));

        if (!sigSocket.action_defer) {
            sigSocket.action_defer = {};
        }
        sigSocket.action_defer[requestId] = Q.defer();
        return sigSocket.action_defer[requestId].promise;
    }).timeout(config.ws_default_timeout).then(function(response) {
        writeToLog(0,'return response data '+require('util').inspect(response)+' for request '+requestId+ ' and peer '+peerId);

        if (!isAgent && !p2p_context) {
            ice.closeSignaling(sigSocket);
        }

        return response;
    }).then(null, function(err) {
        console.error('WS REST REQUEST FAILED '+err+' for request '+requestId+ ' and peer '+peerId);

        if (sigSocket) {
            writeToLog(0,'close ws socket for request '+requestId+ ' and peer '+peerId);
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
        writeToLog(3,'starting setup for peer '+peerId);

        if (ws_socket) {
            sigSocket = ws_socket;
        } else if (p2p_context && p2p_context.wsClientSocket) {
            sigSocket = p2p_context.wsClientSocket.ws_socket;
        }

        if (!sigSocket) {
            writeToLog(0,'CREATE NEW WS CONN');
            sigSocket = ice.setup(onIceMessage, agentId);
        }

        if (!isAgent && p2p_context) {
            var interval;
            if (!p2p_context.wsClientSocket) {
                writeToLog(3,'SET INTERVAL stale ws connection');
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
        writeToLog(0,'starting to initiate ice to '+peerId+' request '+requestId);
        return ice.initiateIce(p2p_context, sigSocket, peerId, true, requestId);
    }).then(function(newSocket) {
        iceSocket = newSocket;

        iceSocket.msgs[requestId] = {};
        msgObj = iceSocket.msgs[requestId];

        msgObj.action_defer = Q.defer();

        if (buffer) {
            buffer = buf.toArrayBuffer(buffer);
            request.size = buffer.byteLength;
        }
        request.req = requestId;

        writeToLog(0,'send request ice to '+peerId+' request '+requestId);

        ice.writeToChannel(iceSocket, JSON.stringify(request), requestId);

        if (buffer) {
            writeBufferToSocket(iceSocket, buffer, requestId);
        }

        writeToLog(0,'wait for response ice to '+peerId+' request '+requestId);

        return msgObj.action_defer.promise;
    }).timeout(config.connection_default_timeout).then(function() {

        msgObj = iceSocket.msgs[requestId];

        writeToLog(0,'got response ice to '+peerId+' request '+requestId+' resp: '+msgObj);

        var response = msgObj.peer_msg;
        if (msgObj.buffer) {
            writeToLog(0,'response: '+response+' has buffer ' + Buffer.isBuffer(msgObj.buffer)+' for request '+requestId+ ' and peer '+peerId);
            response.data = msgObj.buffer;
        }

        writeToLog(0,'close ice socket if needed for request '+requestId+ ' and peer '+peerId);
        ice.closeIce(sigSocket, requestId, iceSocket);

        return response;
    }).then(null, function(err) {
        writeToLog(-1,'ice_api.sendRequest ERROR '+err+' for request '+requestId+ ' and peer '+peerId+' stack '+err.stack);

        if (iceSocket && sigSocket) {
            writeToLog(0,'close ice socket if needed for request '+requestId+ ' and peer '+peerId);
            ice.closeIce(sigSocket, requestId, iceSocket);
        }

        throw err;
    });
};
