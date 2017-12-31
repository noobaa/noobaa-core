/* Copyright (C) 2016 NooBaa */

import template from './object-parts-list.html';
import ObjectPartRowViewModel from './object-part-row';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { paginationPageSize } from 'config';
import { navigateTo } from 'actions';
import { keyByProperty } from 'utils/core-utils';
import { getResourceTypeIcon } from 'utils/ui-utils';
import { action$ } from 'state';
import { openObjectPreviewModal } from 'action-creators';
import { systemInfo, sessionInfo } from 'model';

class ObjectPartsListViewModel extends BaseViewModel {
    constructor({ obj, parts }) {
        super();

        this.pageSize = paginationPageSize;
        this.count = parts.count;

        this.page = ko.pureComputed({
            read: parts.page,
            write: page => navigateTo(undefined, undefined, { page })
        });

        const poolIconMapping = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return {};
                }

                const pools = systemInfo().pools;
                return keyByProperty(pools, 'name', getResourceTypeIcon);
            }
        );

        this.notOwner = ko.pureComputed(
            () => !systemInfo() || !sessionInfo() || (systemInfo().owner.email !== sessionInfo().user)
        );

        this.downloadTooltip = ko.pureComputed(
            () => {
                if (this.notOwner()) {
                    return 'This operation is only available for the system owner';
                }

                return '';
            }
        );

        this.previewTooltip = ko.pureComputed(
            () => {
                if (this.notOwner()) {
                    return {
                        align: 'end',
                        text: 'This operation is only available for the system owner'
                    };
                }

                return '';
            }
        );

        this.rows = ko.pureComputed(() => parts().map(
            (part, i) => {
                const partNumber = this.page() * this.pageSize + i;
                return new ObjectPartRowViewModel(part, partNumber, this.count(), poolIconMapping);
            })
        );

        this.s3SignedUrl = ko.pureComputed(
            () => obj() && obj().s3_signed_url
        );
    }

    onPreviewFile() {
        action$.onNext(openObjectPreviewModal(this.s3SignedUrl()));
    }

    onDownloadClick() {
        return !this.notOwner();
    }
}

export default {
    viewModel: ObjectPartsListViewModel,
    template: template
};
