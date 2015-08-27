'use strict';

// catch process uncaught exceptions, and treat as a panic and exit after logging
// since restarting the process is the most stable way of recovery
process.on('uncaughtException', function(err) {
    console.error('PANIC: process uncaughtException', err.stack || err);
    process.exit(1);
});

var _ = require('lodash');
var Q = require('q');
var http = require('http');
var url = require('url');
var express = require('express');
var WebSocketServer = require('ws').Server;
var thenRedis = require('then-redis');
var uuid = require('node-uuid');
var redis = require('redis');
var posix = require('posix');
var dbg = require('../util/debug_module')(__filename);

// constants
var STATE_INIT = 'init';
var STATE_IDENTIFYING = 'identifying';
var STATE_READY = 'ready';
var STATE_ERROR = 'error';
var STATE_CLOSING = 'closing';
var STATE_CLOSED = 'closed';
var ID_GEN_PREFIX = 'gen-';
var SUB_CHANNEL_PREFIX = 'sub-';

// subscriptions
// note: redis client requires separate client for subscription
var localSubscribe = {};
var redisClient = createRedisClient();
var redisClientSub = createRedisClient();
redisClientSub.on('message', onRedisSubMessage);

// express app with websocket server
var app = express();
var server = http.createServer(app);
var port = process.env.PORT || 5002;
var wss = new WebSocketServer({
    server: server
});
wss.on('connection', onWsConnection);
wss.on('error', onWsServerError);
server.listen(port, function() {
    dbg.log('http server listening on port', port);
});

setInterval(periodicReport, 30000);

// increase maximum number of open file descriptors,
// will not work on heroku.
if (process.env.ULIMIT_NUM_FILES) {
    posix.setrlimit('nofile', {
        soft: process.env.ULIMIT_NUM_FILES,
        hard: process.env.ULIMIT_NUM_FILES
    });
}



// functions //


/**
 *
 */
function onWsConnection(ws) {
    ws.nb = {
        state: STATE_INIT
    };
    ws.on('close', onWsClose.bind(null, ws));
    ws.on('error', onWsError.bind(null, ws));
    ws.on('message', onWsMessage.bind(null, ws));
    ws.sendQ = wsSendQ.bind(null, ws);
}

/**
 *
 */
function onWsMessage(ws, raw) {
    var msg;

    dbg.log('WS MESSAGE', ws.nb.id, raw);

    try {
        msg = JSON.parse(raw);
    } catch (err) {
        dbg.error('WS JSON PARSE ERROR', raw);
        onWsError(ws, err);
        return;
    }

    msg.op = String(msg.op);
    switch (msg.op) {
        case 'identity':
            onIdentity(ws, msg);
            break;
        case 'keepalive':
            onKeepalive(ws, msg);
            break;
        case 'signal':
            onSignal(ws, msg, raw);
            break;
        default:
            onWsBadOp(ws, msg);
            break;
    }
}

/**
 *
 */
function onIdentity(ws, msg) {
    var id;

    // sockets should identify just once,
    // and then will be assigned with id
    if (ws.nb.state !== STATE_INIT) {
        dbg.error('WS ALREADY IDENTIFIED', ws.nb.id, msg);
        onWsError(ws, new Error('ALREADY IDENTIFIED'));
        return;
    }

    ws.nb.state = STATE_IDENTIFYING;

    return Q.fcall(function() {

            // use the id if sent, otherwise generate
            return msg.id ? String(msg.id) : generateIdentity();
        })
        .then(function(idArg) {
            id = idArg;

            // subscribe this id with the socket
            return subscribeIdentity(ws, id);
        })
        .then(function() {

            // update socket state
            ws.nb.id = id;
            ws.nb.state = STATE_READY;

            // send back a response with the id (even if not generated)
            return ws.sendQ(JSON.stringify({
                op: 'identity',
                id: id
            }));
        })
        .then(null, function(err) {
            dbg.error('IDENTITY ERROR', msg);
            onWsError(ws, err);
        });
}


/**
 * Called to pass a message according to the msg.to
 */
function onSignal(ws, msg, raw) {

    if (ws.nb.state !== STATE_READY) {
        dbg.error('WS NOT READY', ws.nb.id, msg);
        onWsError(ws, new Error('NOT READY'));
        return;
    }

    // lookup the 'to' id locally first
    var ws2 = localSubscribe[msg.to];
    if (ws2) {
        dbg.log('SIGNAL SEND', msg.to);
        return ws2.sendQ(raw)
            .then(null, function(err) {
                dbg.error('LOCAL SIGNAL ERROR', err.stack || err);
                return replyUnavailable(ws, msg.to);
            });
    }

    // if not local, publish to channel and check if delivered.
    // NOTE: in the following redis publish path, even if we know the message was delivered,
    // we don't have knowledge here that it was successfully received and processed.
    // for signaling purpose this is fine, but it means that we do not provide
    // reliable channel semantics as local websockets tunneling does.

    var channel = SUB_CHANNEL_PREFIX + msg.to;
    dbg.log('SIGNAL PUBLISH', channel);

    return redisClient.publish(channel, raw)
        .then(function(subscribers) {
            if (subscribers > 1) {
                dbg.warn('TOO MANY SUBSCRIBERS', subscribers, 'channel', channel);
                // TODO with multiple subscribers we should publish a reset on that channel
            }
            return subscribers !== 0;
        })
        .then(function(delivered) {
            if (!delivered) {
                return replyUnavailable(ws, msg.to);
            }
        }, function(err) {
            dbg.error('PUBLISH ERROR', err.stack || err);
            onWsError(ws, err);
        });
}

/**
 *
 */
function onRedisSubMessage(channel, raw) {

    // parse id from channel
    dbg.log('REDIS MESSAGE', channel, raw);
    var id = channel.split(SUB_CHANNEL_PREFIX.length);
    var ws = localSubscribe[id];
    if (!ws) {
        dbg.warn('REDIS STALE', channel, raw);
        return redisClientSub.unsubscribe(channel);
    }

    // parse message
    var msg;
    try {
        msg = JSON.parse(raw);
    } catch (err) {
        dbg.error('REDIS JSON PARSE ERROR', raw);
        onWsError(ws, err);
        return;
    }

    // verify the ids are matching
    if (id !== msg.to || id !== ws.nb.id) {
        dbg.error('REDIS BAD ID', ws.nb, channel, raw);
        onWsError(ws, new Error('REDIS BAD ID'));
        return;
    }

    // only accept signal messages over redis
    if (msg.op !== 'signal') {
        dbg.error('REDIS BAD OP', ws.nb.id, msg);
        onWsError(ws, new Error('REDIS BAD OP'));
        return;
    }

    // handle signal
    dbg.log('REDIS SIGNAL', msg.to);
    return ws.sendQ(raw);
}

/**
 * keepalives are just received to prevent sockets from closing
 */
function onKeepalive(ws, msg) {
    // noop
}

/**
 *
 */
function onWsBadOp(ws, msg) {
    dbg.error('WS BAD OP', ws.nb.id, msg);
    onWsError(ws, new Error('WS BAD OP'));
}

/**
 *
 */
function replyUnavailable(ws, from) {
    return ws.sendQ(JSON.stringify({
        op: 'unavailable',
        from: from,
    }));
}

/**
 *
 */
function generateIdentity() {
    return redisClient.incr('sig-id-gen')
        .then(function(id) {
            dbg.log('GENERATED IDENTITY', id);
            return ID_GEN_PREFIX + id;
        });
}

/**
 *
 */
function subscribeIdentity(ws, id) {
    var old = localSubscribe[id];
    if (old) {
        // TODO not sure how this path will actually close - will it unsubscribe?
        dbg.warn('IDENTITY OVERRIDE', id);
        try {
            old.close();
        } catch (err) {
            dbg.warn('CLOSE OLD WS ERROR', err.stack || err);
        }
    }
    dbg.log('SUBSCRIBE', id);
    localSubscribe[id] = ws;
    return redisClientSub.subscribe(SUB_CHANNEL_PREFIX + id);
}

/**
 *
 */
function unsubscribeIdentity(ws) {
    var id = ws.nb.id;
    if (localSubscribe[id] === ws) {
        dbg.log('UNSUBSCRIBE', id);
        delete localSubscribe[id];
        return redisClientSub.unsubscribe(SUB_CHANNEL_PREFIX + id);
    }
}

/**
 *
 */
function wsSendQ(ws, msg) {
    return Q.ninvoke(ws, 'send', msg)
        .then(null, function(err) {
            dbg.error('WS SEND ERROR', ws.nb, msg);
            onWsError(ws, err);
        });
}

/**
 *
 */
function onWsServerError(err) {
    dbg.error('WS SERVER ERROR', err.stack || err);
}

/**
 *
 */
function onWsClose(ws) {
    dbg.log('WS CLOSE', ws.nb);
    Q.fcall(function() {
        ws.nb.state = STATE_CLOSING;
        return unsubscribeIdentity(ws);
    }).fin(function() {
        ws.nb.state = STATE_CLOSED;
    });
}

/**
 *
 */
function onWsError(ws, err) {
    dbg.error('WS ERROR', ws.nb, err.stack || err);
    ws.nb.state = STATE_ERROR;
    ws.nb.error = err;
    ws.close();
}


/**
 *
 */
function onRedisError(err) {
    dbg.error('REDIS ERROR', err.stack || err);
}

/**
 *
 */
function createRedisClient() {
    var u = url.parse(process.env.REDISTOGO_URL || '');
    var pass = u.auth && u.auth.split(':')[1];
    var client = thenRedis.createClient({
        host: u.hostname,
        port: u.port,
        password: pass
    });
    client.on('error', onRedisError);
    return client;
}

/**
 *
 */
function periodicReport() {
    dbg.log(
        'clients', wss.clients.length,
        'memory', process.memoryUsage());
}
