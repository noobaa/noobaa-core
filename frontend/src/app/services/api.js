import env from 'env';
import { rpc, Client } from 'nb-api';

rpc.base_address = env.serverAddress || 'ws://127.0.0.1:5001';
export default Object.assign(new Client(), { rpc });