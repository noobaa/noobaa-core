import template from './create-pool-wizard.html'
import NodeRowViewModel from './node-row';
//import ko from 'knockout';
import { makeArray } from 'utils';
import { nodeList } from 'model';


class CreatePoolWizardViewModel {
	constructor({ onClose }) {
		this.onClose = onClose;

		this.rows = makeArray(
			500, 
			i => new NodeRowViewModel(() => nodeList()[i])
		);
	}
}

export default {
	viewModel: CreatePoolWizardViewModel,
	template: template
}