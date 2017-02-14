import template from './object-parts-list.html';
import ObjectPartRowViewModel from './object-part-row';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { paginationPageSize } from 'config';
import { redirectTo } from 'actions';
import { openObjectPreviewModal } from 'dispatchers';

class ObjectPartsListViewModel extends BaseViewModel {
    constructor({ obj, parts }) {
        super();

        this.pageSize = paginationPageSize;
        this.count = parts.count;

        this.page = ko.pureComputed({
            read: parts.page,
            write: page => redirectTo(undefined, undefined, { page })
        });

        this.rows = parts.map(
            (part, i) => {
                let partNumber = this.page() * this.pageSize + i();
                return new ObjectPartRowViewModel(part, partNumber, this.count());
            }
        );

        this.s3SignedUrl = ko.pureComputed(
            () => obj() && obj().s3_signed_url
        );
    }

    onPreviewFile() {
        openObjectPreviewModal(this.s3SignedUrl());
    }
}

export default {
    viewModel: ObjectPartsListViewModel,
    template: template
};
