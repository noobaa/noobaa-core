import moment from 'moment';
import categoryMapping from './category-mapping';

// const eventMessageMapping = Object.freeze({
// 	'node.create': 		evt => `Node added: ${evt.node.name}`,
// 	'obj.uploaded': 	evt => `Upload completed: ${evt.obj.key}`,
// 	'bucket.create': 	evt => `Bucket created: ${evt.bucket.name}`,
// 	'bucket.delete': 	evt => `Bucket deleted: ${evt.bucket.name}`,
// 	'account.create': 	evt => `Account created: ${evt.bucket.email}`,
// 	'account.deleted': 	evt => `Account deleted: ${evt.bucket.email}`, 
// });

const eventMapping = Object.freeze({
	'node.create': 		{ event: 'Node Added', 			entity: evt => evt.node.name },
	'obj.uploaded': 	{ event: 'Upload Completed', 	entity: evt => evt.obj.key },
	'bucket.create': 	{ event: 'Bucket Created', 		entity: evt => evt.bucket.name },
	'bucket.delete': 	{ event: 'Bucket Deleted',		entity: evt => evt.bucket.name },
	'account.create': 	{ event: 'Account Created', 	entity: evt => evt.bucket.email },
	'account.deleted': 	{ event: 'Account Deleted', 	entity: evt => evt.bucket.email } 
});

// function unrecognizedEventMessageHandler(evt) {
// 	console.warn(`Unrecognize Audit Event: ${evt}`);
// }

export default class AuditRowViewModel {
	constructor(entry) {
		let category = entry.event.split('.')[0];
		//let messageHandler = eventMessageMapping[entry.event] || unrecognizedEventHandler; 
		let handler = eventMapping[entry.event];

		this.date = moment(entry.time).format('DD MMM YYYY HH:mm:ss');
		this.category = categoryMapping[category];
		//this.user = !!entry.account ? entry.account.email : '';
		this.event = handler.event;
		this.entity = handler.entity(entry);
	}
}