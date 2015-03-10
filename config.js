var config = {};

// SIGNALING AND ICE
config.address = 'ws://ec2-52-10-244-78.us-west-2.compute.amazonaws.com:5002'; // (on heroku: ws://noobaa-signaling.herokuapp.com)
//config.address = 'ws://3.3.3.101:5002'; // (on heroku: ws://noobaa-signaling.herokuapp.com)
config.alive_delay = 10 * 1000;
config.reconnect_delay = 5000;
config.connection_data_stale = 10 * 60 * 1000;
config.check_stale_conns = 60 * 1000;
config.chunk_size = 60 * 1000;
config.doStaleCheck = false;
config.buildWorkerOn = false;
config.connection_default_timeout = 6 * 1000;
config.ice_retry = 2;

config.use_ws_when_possible = true;
config.use_ice_when_possible = true;

config.dbg_log_level = 2;

// ACTION CONCURRENCY
config.READ_CONCURRENCY = 32;
config.WRITE_CONCURRENCY = 16;
config.READ_RANGE_CONCURRENCY = 8;
config.REPLICATE_CONCURRENCY = 32;

// WEB SERVER
config.web_address = 'http://3.3.3.101:5001';
config.web_address_heroku = 'https://noobaa-core.herokuapp.com';

config.ice_servers = {
    'iceServers': [
        {'url': 'stun:stun.l.google.com:19302'},
        {'url': 'stun:stun.stunprotocol.org:3478'},
        {'url': 'stun:192.168.59.103:3478'}
    ]
};

module.exports = config;
