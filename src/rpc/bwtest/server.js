'use strict';

var _ = require('lodash');
var http = require('http');
var express = require('express');
var browserify = require('browserify-middleware');
var WebSocketServer = require('ws').Server;

var app = express();
var server = http.createServer(app);
var port = process.env.PORT || 5999;

var wss = new WebSocketServer({
    server: server,
    path: "/ws"
});
wss.on('connection', on_ws_connection);
wss.on('error', on_ws_error);

app.get('/client.js', browserify(__dirname + '/client.js'));

app.use(express.static(__dirname + "/"));

server.listen(port, function() {
    console.log("http server on port", port);
});



////////
// WS //
////////

var peers_map = {};
var ready_peers = [];
var next_peer_id = 1;

function on_ws_connection(ws) {
    console.log('connected');

    ws.on('close', function() {
        console.log('closed:', ws.peer_id);
        _.pull(ready_peers, ws);
        delete peers_map[ws.peer_id];
    });

    ws.on('message', function(raw_msg) {
        console.log('WS received:', raw_msg);
        var msg = JSON.parse(raw_msg);
        if (msg.type === 'ready') {
            handle_ready();
        } else if (msg.type === 'signal') {
            handle_signal(msg);
        }
    });

    handle_ready();


    function handle_ready() {
        delete peers_map[ws.peer_id];
        ws.peer_id = next_peer_id;
        next_peer_id += 1;
        peers_map[ws.peer_id] = ws;

        var ws2 = ready_peers.shift();
        if (!ws2) {
            console.log('WS ready and waiting for someone to join', ws.peer_id);
            ready_peers.push(ws);
        } else {
            console.log('WS ready and notify', ws2.peer_id, ws.peer_id);
            ws2.send(JSON.stringify({
                type: 'ready',
                from_id: ws2.peer_id,
                to_id: ws.peer_id,
            }));
            ws.send(JSON.stringify({
                type: 'ready',
                from_id: ws.peer_id,
                to_id: ws2.peer_id,
                initiator: true
            }));
        }
    }

    function handle_signal(msg) {
        var ws2 = peers_map[msg.to_id];
        if (ws2) {
            console.log('signal from', msg.from_id, 'to', msg.to_id);
            ws2.send(JSON.stringify(msg));
        }
    }
}

function on_ws_error(err) {
    console.error('WS ERROR', err);
}
