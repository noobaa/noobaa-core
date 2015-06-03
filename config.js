var config = {};

// TEST Mode
config.test_mode = false;

// On Premise NVA params
config.on_premise = {
    base_url: "https://s3-eu-west-1.amazonaws.com/noobaa-download/on_premise/v_",
    nva_part: "NVA_Upgrade.tgz"
};

// Central Stats Collection
config.central_stats = {
  send_stats: true,
  central_listener: '',
};

// SIGNALING AND ICE
config.ws_address = 'wss://noobaa-signaling.herokuapp.com';
//config.ws_address = 'ws://localhost:5002';
config.alive_delay = 10 * 1000;
config.reconnect_delay = 50;
config.connection_data_stale = 5 * 60 * 1000;
config.connection_ws_stale = 15 * 60 * 1000;
config.check_stale_conns = 60 * 1000;

config.chunk_size = (16 * 1024) - 100;
config.doStaleCheck = true;

config.iceBufferMetaPartSize = 64;

config.use_ws_when_possible = true;
config.use_ice_when_possible = true;

config.dbg_log_level = 2;

config.min_node_number = 3;

// ACTION CONCURRENCY
config.READ_CONCURRENCY = 32;
config.WRITE_CONCURRENCY = 16;
config.READ_RANGE_CONCURRENCY = 8;

config.REPLICATE_CONCURRENCY = 16;

config.write_timeout = 120 * 1000;
config.read_timeout = 120 * 1000;
config.server_finalize_build_timeout = 120 * 1000;

// ~60 seconds overall before give up on this channel
config.channel_send_congested_attempts = 1000;
config.channel_send_congested_delay = 5;
config.channel_send_timeout = 15 * 1000;
config.channel_buffer_start_throttle = 1 * 1024 * 1024;
config.channel_buffer_stop_throttle = 0;

config.ice_conn_timeout = 10 * 1000;
config.response_timeout = 10 * 1000;
config.ws_conn_timeout = 10 * 1000;

config.ice_servers = {
    'iceServers': [{
        'url': 'stun:stun.l.google.com:19302'
    }, {
        'url': 'stun:stun.stunprotocol.org:3478'
    }, {
        'url': 'stun:54.93.86.231:3478'
    }]
};

module.exports = config;
