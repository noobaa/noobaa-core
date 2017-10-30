/* Copyright (C) 2016 NooBaa */

import template from './audit-pane.html';
import AuditRowViewModel from './audit-row';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { auditLog } from 'model';
import { loadAuditEntries, loadMoreAuditEntries, exportAuditEnteries } from 'actions';
import categories from './categories';
import { deepFreeze } from 'utils/core-utils';
import { infinitScrollPageSize as pageSize } from 'config';

const columns = deepFreeze([
    'time',
    'account',
    'category',
    'event',
    'entity'
]);

class AuditPaneViewModel extends BaseViewModel {
    constructor({ onClose }) {
        super();

        this.onClose = onClose;
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

        this.columns = columns;
        this.entries = auditLog;
        this.isLoading = false;
        this.addToDisposeList(
            this.entries.subscribe(
                () => {
                    this.scroll(1 - pageSize/this.entries().length);
                    this.isLoading = false;
                }
            )
        );

        let _scroll = ko.observable(0);
        this.scroll = ko.pureComputed({
            read: _scroll,
            write: pos => {
                _scroll(pos);
                const maxPos = 1 - 1/this.entries().length;
                if (!this.isLoading && (pos > maxPos)){
                    this.isLoading = true;
                    loadMoreAuditEntries(pageSize);
                }
            }
        });

        this.selectedRow = ko.observable();

        this.description = ko.pureComputed(
            () => this.selectedRow() && this.selectedRow().description()
        );

        this.selectedCategories(Object.keys(categories));
    }

    onX() {
        this.onClose();
    }

    createAuditRow(auditEntry) {
        return new AuditRowViewModel(auditEntry, this.selectedRow);
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
}

export default {
    viewModel: AuditPaneViewModel,
    template: template
};
