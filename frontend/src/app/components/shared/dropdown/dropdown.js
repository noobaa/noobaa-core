import template from "./dropdown.html";
import { randomString } from 'utils';
import ko from 'knockout';

class DropdownViewModel {
<<<<<<< HEAD
    constructor(params) {
        this.options = params.options.map(opt => {
            if (opt !== 'object') {
                opt = { value: opt, label: opt.toString(), action: params.action }
            }

            if (opt.label == null) {
                opt.label = opt.value.toString();
            }

            if (typeof opt.action !== 'function') {
                opt.action = params.action;
            }

            return opt;
        });
    }
=======
	constructor({ 
		selected = ko.observable(), 
		options = [], 
		placeholder = '', 
		disabled = false 
	}) {
		this.name = randomString(5);
		this.options = options;
		this.selected = selected;
		this.disabled = disabled;
		this.focused = ko.observable(false)

		this.selectedLabel = ko.pureComputed(
			() => !!selected() ? options.find( 
					opt => opt.value === this.selected()
				).label : placeholder
		);
	}
>>>>>>> 5899a610afcb3d598d4507eb1f86f1bfdcc9a9cb
}

export default {
    viewModel: DropdownViewModel,
    template: template
}