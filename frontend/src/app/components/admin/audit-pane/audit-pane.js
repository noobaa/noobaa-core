import template from './audit-pane.html';
import AuditRowViewModel from './audit-row';
import Disposable from 'disposable';
import ko from 'knockout';
import { auditLog } from 'model';
import { loadAuditEntries, loadMoreAuditEntries, exportAuditEnteries, closeDrawer } from 'actions';
import categories from './categories';

const pageSize = 25;
const scrollThrottle = 750;

class AuditPaneViewModel extends Disposable {
    constructor() {
        super();

        this.categories = Object.keys(categories).map(
            key => ({
                value: key,
                label: categories[key].displayName
            })
        );

        this.selectedCategories = ko.pureComputed({
            read: auditLog.loadedCategories,
            write: categoryList => {
                this.selectedRow(null);
                loadAuditEntries(categoryList, pageSize);
            }
        });

        this.rows = auditLog.map(
            entry => new AuditRowViewModel(entry, this.categoreis)
        );

        this.selectedRow = ko.observable();

        this.scroll = ko.observable()
            .extend({
                rateLimit: {
                    method: 'notifyWhenChangesStop',
                    timeout: scrollThrottle
                }
            });

        this.disposeWithMe(
            this.scroll.subscribe(
                pos => pos > .9 && loadMoreAuditEntries(pageSize)
            )
        );

        this.description = ko.pureComputed(
            () => this.selectedRow() ? this.selectedRow().description : []
        );

        this.selectedCategories(Object.keys(categories));
    }

    isRowSelected(row) {
        return this.selectedRow() === row;
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
