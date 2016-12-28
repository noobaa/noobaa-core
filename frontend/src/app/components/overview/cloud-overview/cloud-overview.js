import template from './cloud-overview.html';
import BaseViewModel from 'base-view-model';
import { stringifyAmount } from 'utils/string-utils';
import ko from 'knockout';
import { systemInfo } from 'model';

class CloudOverviewViewModel extends BaseViewModel {
    constructor() {
        super();

        const resourceCounters = ko.pureComputed(
            () => (systemInfo() ? systemInfo().pools : [])
                .filter(
                    pool => Boolean(pool.cloud_info)
                )
                .map(
                    pool =>  pool.cloud_info.endpoint_type
                )
                .reduce(
                    (counters, type) => {
                        ++counters.ALL;
                        ++counters[type];
                        return counters;
                    },
                    { ALL: 0, AWS: 0, AZURE: 0, S3_COMPATIBLE: 0 }
                )
        );

        this.cloudResourceCount = ko.pureComputed(
            () => stringifyAmount(
                'Resource',
                resourceCounters().ALL,
                'No'
            )
        );

        this.awsResourceIcon = ko.pureComputed(
            () => resourceCounters().AWS === 0 ?
                'aws-s3-resource' :
                'aws-s3-resource-colored'
        );

        this.awsResourceCount = ko.pureComputed(
            () => stringifyAmount(
                'Resource',
                resourceCounters().AWS,
                'No'
            )
        );

        this.azureResourceIcon = ko.pureComputed(
            () => resourceCounters().AZURE === 0 ?
                'azure-resource' :
                'azure-resource-colored'
        );

        this.azureResourceCount = ko.pureComputed(
            () => stringifyAmount(
                'Resource',
                resourceCounters().AZURE,
                'No'
            )
        );

        this.genericResourceIcon = ko.pureComputed(
            () => resourceCounters().S3_COMPATIBLE === 0 ?
                'cloud-resource' :
                'cloud-resource-colored'
        );

        this.genericResourceCount = ko.pureComputed(
            () => stringifyAmount(
                'Resource',
                resourceCounters().S3_COMPATIBLE,
                'No'
            )
        );

    }
}

export default {
    viewModel: CloudOverviewViewModel,
    template: template
};
