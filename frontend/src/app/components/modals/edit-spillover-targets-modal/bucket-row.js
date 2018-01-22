import ko from 'knockout';
import { getBucketStateIcon, getPlacementTypeDisplayName} from 'utils/bucket-utils';
import { stringifyAmount } from 'utils/string-utils';
import { pick, flatMap } from 'utils/core-utils';

export default class BucketRowViewModel {
    constructor({ onToggle }) {
        this.status = ko.observable();
        this.name = ko.observable();
        this.placement = ko.observable();
        this.usage = ko.observable();

        // This computed is used as a glue with table checkbox-cell
        // A better approch will be a cell implementation that communicate
        // via events instead of observables.
        this._selected = ko.observable();
        this.selected = ko.pureComputed({
            read: this._selected,
            write: val => onToggle(this.name(), val)
        });
    }

    onBucket(bucket, selected) {
        const { policyType, mirrorSets } = bucket.placement;
        const resources = flatMap(mirrorSets, ms => ms.resources);
        const placement = {
            tooltip: resources.map(resource => resource.name),
            text: `${
                getPlacementTypeDisplayName(policyType)
            } on ${
                stringifyAmount('resource', resources.length)
            }`
        };

        this.status(getBucketStateIcon(bucket));
        this.name(bucket.name);
        this.placement(placement);
        this.usage(pick(bucket.storage, ['used', 'total']));
        this._selected(selected);
    }
}
