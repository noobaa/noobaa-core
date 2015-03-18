var config = {};

// SIGNALING AND ICE
config.address = 'wss://noobaa-signaling.herokuapp.com'; // (on heroku: wss://noobaa-signaling.herokuapp.com) ws://192.168.1.6:5002
config.alive_delay = 10 * 1000;
config.reconnect_delay = 5000;
config.connection_data_stale = 5 * 60 * 1000;
config.connection_ws_stale = 15 * 60 * 1000;
config.check_stale_conns = 60 * 1000;

config.chunk_size = (16 * 1024) - 100;
config.doStaleCheck = true;
config.connection_default_timeout = 5 * 1000;
config.ws_default_timeout = 10 * 1000;
config.ice_retry = 1;
config.replicate_retry = 2;

config.iceBufferMetaPartSize = 64;
config.timeoutToBufferWait = 10;

config.use_ws_when_possible = true;
config.use_ice_when_possible = true;

config.dbg_log_level = 2;

config.min_node_number = 3;

// ACTION CONCURRENCY
config.READ_CONCURRENCY = 32;
config.WRITE_CONCURRENCY = 16;
config.READ_RANGE_CONCURRENCY = 8;
config.REPLICATE_CONCURRENCY = 32;

config.ice_servers = {
    'iceServers': [
        {'url': 'stun:stun.l.google.com:19302'},
        {'url': 'stun:stun.stunprotocol.org:3478'},
        {'url': 'stun:54.93.86.231:3478'}
    ]
};

module.exports = config;
