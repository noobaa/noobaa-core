import { new_rpc } from 'nb-api';

const rpc_proto = window.WebSocket ?
    (window.location.protocol === 'https:' ? 'wss:' : 'ws:') :
    window.location.protocol;

const base_address = `${rpc_proto}//${window.location.hostname}:${window.location.port}`;

const rpc = new_rpc(base_address);
rpc.set_request_logger(
    (...args) => console.info(...args)
);

export default window.api = rpc.new_client();
