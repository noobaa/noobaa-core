// raise maximum number of open file descriptors to 30k,
// hard limit is left unchanged
//var posix = require('posix');
//posix.setrlimit('nofile', { soft: 30000, hard: 30000 });

var WebSocketServer = require("ws").Server;
var http = require("http");
var express = require("express");
var uuid = require('node-uuid');

var app = express();
var server = http.createServer(app);
var port = process.env.PORT || 5000;
app.use(express.static(__dirname + "/"));


var rest = express(); // the sub app
rest.get('/', function (req, res) {
    console.log(rest.mountpath); // /rest
    if (req.query.from && req.query.to && req.query.filename) {
        msgNode(req.query.from, JSON.stringify({type: 'ready', to: req.query.to, filename: req.query.filename}), req.query.to);
        msgNode(req.query.to, JSON.stringify({type: 'accept', from: req.query.from, filename: req.query.filename }), req.query.from);
    }
    res.send('Rest Homepage from: '+req.query.from+' to: '+req.query.to+' file: '+req.query.filename);
});
app.use('/rest', rest); // mount the sub app

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
if (process.env.REDISTOGO_URL) {
    var rtg   = require("url").parse(process.env.REDISTOGO_URL);

    var redisClientSub = redis.createClient(rtg.port, rtg.hostname);
    redisClientSub.auth(rtg.auth.split(":")[1]);

    var redisClientPub = redis.createClient(rtg.port, rtg.hostname);
    redisClientPub.auth(rtg.auth.split(":")[1]);
} else {
    redisClientSub = redis.createClient();
    redisClientPub = redis.createClient();
}


redisClientSub.on("error", function (err) {
    console.log("Error " + err);
});
redisClientPub.on("error", function (err) {
    console.log("Error " + err);
});

redisClientSub.subscribe("sig-channel");

redisClientSub.on("message", function (channel, message) {
    console.log("channel " + channel + ": " + message);
    var msgObj = JSON.parse(message);
    if (channel === "sig-channel" && msgObj.type === "ice") {
        var node2 = msgObj.to;
        if (wsmap[node2]) {
            wsmap[node2].send(msgObj.data);
        }
    }
});

function msgNode(node, msg, from) {
    if (wsmap[node]) {
        console.log('send locally ' + msg + ' to ' + node);
        wsmap[node].send(msg);
    } else {
        console.log('broadcast ' + msg + ' to ' + node);
        redisClientPub.publish("sig-channel", JSON.stringify({type: 'ice', from: from, to: node, data: msg}));
    }
}

var wss = new WebSocketServer({
    server: server
})
    .on("connection", function(ws) {
        var id = uuid.v4();
        count += 1;
        wsmap[id] = ws;

        ws.send(JSON.stringify({type: 'id', id: id}));

        ws.on("close", function() {
            count -= 1;
            delete wsmap[id];
        });

        ws.on('message', function(msg) {

            var message = JSON.parse(msg);

            if (message.type === 'id') {
                console.log('got id from client - use that instead ' + message.id);
                wsmap[message.id] = ws;
                delete wsmap[id];
                id = message.id;
            } else if (message.type === 'ice') {
                console.log('ice from '+ id+' to ' +message.to);
                msgNode(message.to, msg, id);
            } else if (message.type === 'accept') {
                console.log('accept from '+ id+' to ' +message.to);
                msgNode(message.to, msg, id);
            } else if (message.type === "keepalive") {
                //do nothing
            } else {
                console.log('ws message', id, msg);
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

function exitHandler(options, err) {
    if (options.cleanup) console.log('clean');
    if (err) console.log(err.stack);
    console.log('exiting');
    process.exit();
}

//do something when app is closing
process.on('exit', exitHandler.bind(null,{cleanup:true}));

//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit:true}));

//catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {exit:true}));