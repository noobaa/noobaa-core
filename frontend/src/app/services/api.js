/* Copyright (C) 2016 NooBaa */

import { new_rpc_default_only } from 'nb-api';
import * as notifications from './notifications';

const { location, WebSocket } = global;
const rpc_proto = WebSocket ?
    (location.protocol === 'https:' ? 'wss:' : 'ws:') :
    location.protocol;

const base_address = `${rpc_proto}//${location.host}`;
const rpc = new_rpc_default_only(base_address);

rpc.register_service(
    rpc.schema.frontend_notifications_api,
    notifications,
    {}
);

const api = rpc.new_client();
rpc.on('reconnect', () => api.redirector.register_for_alerts());

export default api;

