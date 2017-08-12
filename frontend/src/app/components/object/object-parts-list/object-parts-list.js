/* Copyright (C) 2016 NooBaa */

import template from './object-parts-list.html';
import ObjectPartRowViewModel from './object-part-row';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { paginationPageSize } from 'config';
import { navigateTo } from 'actions';
import { deepFreeze, keyByProperty } from 'utils/core-utils';
import { action$ } from 'state';
import { openObjectPreviewModal } from 'action-creators';
import { systemInfo, sessionInfo } from 'model';
import { getResourceTypeIcon } from 'utils/ui-utils';

const allowedResoruceTypes = deepFreeze([ 'HOSTS', 'CLOUD', 'INTERNAL' ]);


function poolIconMapper(pool) {
    const endpointType = pool.cloud_info && pool.cloud_info.endpoint_type;

    return getResourceTypeIcon(pool.resource_type, endpointType);
}

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

                const pools = systemInfo().pools
                    .filter(pool => allowedResoruceTypes.includes(pool.resource_type));

                return keyByProperty(pools, 'name', poolIconMapper);
            }
        );

        this.notOwner = ko.pureComputed(
            () => !systemInfo() || !sessionInfo() || (systemInfo().owner.email !== sessionInfo().user)
        );

        this.tooltip = ko.pureComputed(
            () => {
                if (this.notOwner()) {
                    return 'This operation is only available for the system owner';
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
