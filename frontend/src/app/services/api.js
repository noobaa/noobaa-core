/* Copyright (C) 2016 NooBaa */

import { new_rpc_default_only } from 'nb-api';
import * as notifications from './notifications';

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
    notifications,
    {}
);

const api = rpc.new_client();
rpc.on('reconnect', () => api.redirector.register_for_alerts());

export default window.api = api;

