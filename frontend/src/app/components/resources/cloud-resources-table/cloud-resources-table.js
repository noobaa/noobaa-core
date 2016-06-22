import template from './cloud-resources-table.html';
import ko from 'knockout';
import CloudResourceRowViewModel from './cloud-resource-row';
import { systemInfo } from 'model';
import { makeArray } from 'utils';


const maxRows = 100;

class CloudResourcesTableViewModel {
    constructor() {
        // let resources = ko.pureComputed(
        //     () => {
        //         if (!systemInfo()) {
        //             return;
        //         }

        //         return systemInfo().pools.filter(
        //             ({ cloud_info }) => cloud_info
        //         );
        //     }
        // );

        let resources = ko.observable(makeArray(
            10,
            () => ({
                name: 'aws-bucket-1',
                storage: {  used: Number.MAX_SAFE_INTEGER },
                cloud_info: {
                    endpoint: 'https://s3.amazonaws.com',
                    target_bucket: 'bucket-123'
                }
            })
        ));

        let rows = makeArray(
            maxRows,
            i => new CloudResourceRowViewModel(() => resources() && resources()[i])
        );

        this.visibleRows = ko.pureComputed(
            () => rows.filter(row => row.isVisible())
        );

        this.deleteGroup = ko.observable();

        this.isAddCloudResourceModalVisible = ko.observable(false);
    }

    showAddCloudResourceModal() {
        this.isAddCloudResourceModalVisible(true);
    }

    hideCloudReousrceModal() {
        this.isAddCloudResourceModalVisible(false);
    }
}

export default {
    viewModel: CloudResourcesTableViewModel,
    template: template
};
