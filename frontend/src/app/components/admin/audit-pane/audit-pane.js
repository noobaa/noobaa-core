import template from './audit-pane.html';
import AuditRowViewModel from './audit-row';
import ko from 'knockout';
import { auditLog } from 'model';
import { loadAuditEntries, loadMoreAuditEntries } from 'actions';
import categoryMapping from './category-mapping';

const pageSize = 25;
const scrollThrottle = 750;

class AuditPaneViewModel {
	constructor() {
		this.categories = Object.keys(categoryMapping).map(
			key => ({ value: key, label: categoryMapping[key] })
		);

		this.selectedCategories = ko.pureComputed({
			read: auditLog.loadedCategories,
			write: categoryList => loadAuditEntries(categoryList, pageSize)
		});

		this.rows = auditLog.map(
			entry => new AuditRowViewModel(entry, this.categoreis)
		);

		this.scroll = ko.observable()
			.extend({ 
				rateLimit: { 
					method: 'notifyWhenChangesStop', 
					timeout: scrollThrottle 
				}
			});

		this.scroll.subscribe(
			pos => pos > .9 && loadMoreAuditEntries(pageSize)
		);
	}

	selectAllCategories() {
		this.selectedCategories(
			this.categories.map(
				category => category.value
			)
		);
	}

	clearAllCategories() {
		this.selectedCategories([]);
	}
}

export default {
	viewModel: AuditPaneViewModel,
	template: template
}