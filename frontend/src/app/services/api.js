import { new_rpc_default_only } from 'nb-api';
import * as notifs from './notifications';

const rpc_proto = window.WebSocket ?
    (window.location.protocol === 'https:' ? 'wss:' : 'ws:') :
    window.location.protocol;
const base_address = `${rpc_proto}//${window.location.host}`;
const rpc = new_rpc_default_only(base_address);

rpc.set_request_logger(
    (...args) => console.info(...args)
);

rpc.register_service(
    rpc.schema.frontend_notifications_api,
    notifs,
    {}/*options*/
);

const client = window.api = rpc.new_client();
export default client;
