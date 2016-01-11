import moment from 'moment';

export default class AuditRowViewModel {
	constructor(entry) {
		this.date = moment(entry).format('DD MMM YYYY');
		this.time = moment(entry).format('HH:mm:ss');
		this.category = entry.event.split('.')[0];
		this.user = !!entry.account ? entry.account.email : '';
		this.message = 'We need to add a message here';
	}
}