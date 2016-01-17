import ko from 'knockout';

export default class AccountRowViewModel {
	constructor(account, deleteCandidate) {
		this.isVisible = ko.pureComputed(
			() => !!account()
		);

		this.user = ko.pureComputed(
			() => !!account() && account().email
		);

		// TODO: return real role when avaliable
		this.role = ko.pureComputed(
			() => 'Admin'
		);

		// TODO: return real status when avaliable
		this.status = ko.pureComputed(
			() => 'Active' 
		);

		this.allowDelete = ko.pureComputed(
			() => !this.isDisabled() && bucket().num_objects === 0
		);

		this.isDeleteCandidate = ko.pureComputed({
			read: () => deleteCandidate() === this,
			write: value => value ? deleteCandidate(this) : deleteCandidate(null)
		});		

		this.deleteIcon = ko.pureComputed(
			() => `/fe/assets/icons.svg#trash-${
				this.allowDelete() ? 
					(this.isDeleteCandidate() ? 'opened' : 'closed') : 
					'disabled'
			}`
		);

		this.deleteTooltip = ko.pureComputed( 
			() => this.allowDelete() ? 'delete bucket' : 'bucket is not empty'
		);		
	}
}