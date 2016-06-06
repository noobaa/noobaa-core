import { new_rpc } from 'nb-api';
import { hostname, port } from 'server-conf';

let rpc_proto = window.WebSocket ?
    (window.location.protocol === 'https:' ? 'wss:' : 'ws:') :
    window.location.protocol;

let base_address = `${rpc_proto}//${
        hostname || window.location.hostname
    }:${
        port || window.location.port
    }`;

let rpc = new_rpc(base_address);

rpc.set_request_logger(
    (...args) => console.info(...args)
);

let client = rpc.new_client();

export default window.api = client;
