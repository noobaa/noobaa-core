import { rpc, Client } from 'nb-api';

const baseAddress = 'ws://192.168.56.102:5001';

rpc.base_address = baseAddress;
let client = new Client();
client.rpc = rpc;

export default client;