import { rpc, Client } from 'nb-api';

const baseAddress = 'ws://192.168.56.102:5001';
const credentials = Object.freeze({ 
	system: 'demo',
	email:  'demo@noobaa.com',
	password: 'DeMo'
});

rpc.base_address = baseAddress;
let client = new Client();

export default {
	init() {
		return client.create_auth_token(credentials);
	},
	
	read_node(...args) { 
		return client.node.read_node(...args); 
	},

	read_node_maps(...args) { 
		return client.node.read_node_maps(...args); 
	},

	read_system(...args) {
		return client.system.read_system(...args); 	
	}
};