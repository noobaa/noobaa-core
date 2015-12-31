import { serverAddress, serverPort } from 'config';
import { rpc, Client } from 'nb-api';

rpc.base_address = `ws://${serverAddress}:${serverPort}`;
rpc.set_reply_logger(
	(...args) => console.info(...args)
);
export default window.api = Object.assign(new Client(), { rpc });