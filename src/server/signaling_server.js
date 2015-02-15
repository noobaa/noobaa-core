// raise maximum number of open file descriptors to 30k,
// hard limit is left unchanged
//var posix = require('posix');
//posix.setrlimit('nofile', { soft: 30000, hard: 30000 });

var WebSocketServer = require("ws").Server;
var http = require("http");
var express = require("express");
var thenRedis = require('then-redis');
var uuid = require('node-uuid');

var app = express();
var server = http.createServer(app);
var port = process.env.PORT || 5000;
app.use(express.static(__dirname + "/"));

var count = 0;
var wsmap = {};

setInterval(function() {
    console.log(
        'clients', count,
        'memory', process.memoryUsage());
}, 30000);

var redis = require("redis");

var redisClientSub;
var redisClientPub;
var redisClientId;
if (process.env.REDISTOGO_URL) {
    var rtg   = require("url").parse(process.env.REDISTOGO_URL);

    redisClientSub = redis.createClient(rtg.port, rtg.hostname);
    redisClientSub.auth(rtg.auth.split(":")[1]);

    redisClientPub = redis.createClient(rtg.port, rtg.hostname);
    redisClientPub.auth(rtg.auth.split(":")[1]);

    redisClientId = thenRedis.createClient({
        host: rtg.hostname,
            port: rtg.port
    });
    redisClientId.auth(rtg.auth.split(":")[1]);
} else {
    redisClientSub = redis.createClient();
    redisClientPub = redis.createClient();
    redisClientId = thenRedis.createClient();
}


redisClientSub.on("error", function (err) {
    console.log("redisClientSub Error " + err);
});
redisClientPub.on("error", function (err) {
    console.log("redisClientPub Error " + err);
});
redisClientId.on("error", function (err) {
    console.log("redisClientId Error " + err);
});

redisClientSub.subscribe("sig-channel");

redisClientSub.on("message", function (channel, message) {
    console.log("channel " + channel + ": " + message);
    var msgObj = JSON.parse(message);
    if (channel === "sig-channel" && msgObj.sigType === "ice") {
        var node2 = msgObj.to;
        if (wsmap[node2]) {
            wsmap[node2].send(msgObj.data);
        }
    }
});

function msgNode(node, msg, from) {
    if (wsmap[node]) {
        console.error('send locally ' + msg + ' to ' + node);
        wsmap[node].send(msg);
    } else {
        console.error('broadcast ' + msg + ' to ' + node);
        redisClientPub.publish("sig-channel", JSON.stringify({sigType: 'ice', from: from, to: node, data: msg}));
    }
}

var wss = new WebSocketServer({
    server: server
})
    .on("connection", function(ws) {

        var id;
        redisClientId.incr('my-clients').done(function (res){
            id = res;
            if (!id) {
                id = uuid.v4();
            } else {
                id = 'client-' + id;
            }

            count += 1;
            wsmap[id] = ws;

            var idMsg = JSON.stringify({sigType: 'id', id: id});

            console.error('send id ' + idMsg + ' to ' + id);

            ws.send(idMsg);
        });

        ws.on("close", function() {
            count -= 1;
            delete wsmap[id];
        });

        ws.on('message', function(msg) {

            var message = JSON.parse(msg);

            if (message.sigType === 'id') {
                console.error('got id from client - use that instead ' + message.id);
                wsmap[message.id] = ws;
                delete wsmap[id];
                id = message.id;
            } else if (message.sigType === 'ice') {
                console.error('ice from '+ id+' to ' +message.to);
                msgNode(message.to, msg, id);
            } else if (message.sigType === 'accept') {
                console.error('accept from '+ id+' to ' +message.to);
                msgNode(message.to, msg, id);
            } else if (message.sigType === "keepalive") {
                //console.error('keepalive message');
            } else {
                console.error('ws message', id, msg);
            }
        });


    })
    .on('error', function(err) {
        console.error('ERROR', err);
    });

server.listen(port, function() {
    console.log("http server listening on %d", port);
});

process.stdin.resume();//so the program will not close instantly

function exitHandler() {
    console.log('exiting');
    process.exit();
}

//do something when app is closing
process.on('exit', exitHandler);

//catches uncaught exceptions
process.on('uncaughtException', function(err) {
    console.error('uncaughtException '+err.stack);
    exitHandler();
});