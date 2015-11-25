import env from 'env';
import { rpc, Client } from 'nb-api';

rpc.base_address = env.serverAddress;
export default Object.assign(new Client(), { rpc });