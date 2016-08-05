import template from './audit-pane.html';
import AuditRowViewModel from './audit-row';
import Disposable from 'disposable';
import ko from 'knockout';
import { auditLog } from 'model';
import { loadAuditEntries, loadMoreAuditEntries, exportAuditEnteries, closeDrawer } from 'actions';
import categories from './categories';
import { deepFreeze } from 'utils';
import { infinitScrollPageSize as pageSize } from 'config';

const columns = deepFreeze([
    'time',
    'account',
    'category',
    'event',
    'entity'
]);

class AuditPaneViewModel extends Disposable {
    constructor() {
        super();

        this.columns = columns;

        this.categories = Object.keys(categories).map(
            key => ({
                value: key,
                label: categories[key].displayName
            })
        );

        this.selectedCategories = ko.pureComputed({
            read: auditLog.loadedCategories,
            write: categoryList => {
                this.description([]);
                loadAuditEntries(categoryList, pageSize);
            }
        });

        this.entries = auditLog;

        this.rows = auditLog.map(
            entry => new AuditRowViewModel(entry, this.categoreis)
        );

        let _scroll = ko.observable(0);
        this.scroll = ko.pureComputed({
            read: _scroll,
            write: pos => {
                _scroll(pos);
                if (pos > .9) loadMoreAuditEntries(pageSize);
            }
        });

        this.description = ko.observable();

        this.selectedCategories(Object.keys(categories));
    }

    createAuditRow(auditEntry) {
        return new AuditRowViewModel(auditEntry);
    }

    selectAllCategories() {
        this.selectedCategories(
            Object.keys(categories)
        );
    }

    clearAllCategories() {
        this.selectedCategories([]);
    }

    exportToCSV() {
        exportAuditEnteries(this.selectedCategories());
    }

    closeDrawer() {
        closeDrawer();
    }
}

export default {
    viewModel: AuditPaneViewModel,
    template: template
};
