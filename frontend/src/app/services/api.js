import env from 'env';
import { rpc, Client } from 'nb-api';

rpc.base_address = env.serverAddress || 'localhost:5001';
export default Object.assign(new Client(), { rpc });