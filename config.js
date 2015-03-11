var config = {};

// SIGNALING AND ICE
config.address = 'wss://noobaa-signaling.herokuapp.com'; // (on heroku: ws://noobaa-signaling.herokuapp.com)
config.alive_delay = 10 * 1000;
config.reconnect_delay = 5000;
config.connection_data_stale = 10 * 60 * 1000;
config.check_stale_conns = 60 * 1000;
config.chunk_size = 8 * 1024;
config.doStaleCheck = false;
config.connection_default_timeout = 25 * 1000;
config.ws_default_timeout = 25 * 1000;
config.ice_retry = 0;

config.use_ws_when_possible = true;
config.use_ice_when_possible = true;

config.dbg_log_level = 2;

// ACTION CONCURRENCY
config.READ_CONCURRENCY = 32;
config.WRITE_CONCURRENCY = 16;
config.READ_RANGE_CONCURRENCY = 8;
config.REPLICATE_CONCURRENCY = 32;

config.ice_servers = {
    'iceServers': [
        {'url': 'stun:54.93.86.231:3478'}
    ]
};

module.exports = config;
