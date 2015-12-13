import config from 'config';
import { rpc, Client } from 'nb-api';

rpc.base_address = config.serverAddress || 'ws://127.0.0.1:5001';
export default Object.assign(new Client(), { rpc });