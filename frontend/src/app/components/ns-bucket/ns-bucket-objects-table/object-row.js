import ko from 'knockout';
import moment from 'moment';
import { formatSize } from 'utils/size-utils';
import { timeShortFormat } from 'config';
import { openObjectPreviewModal } from 'action-creators';
import { action$ } from 'state';

export default class  ObjectRowViewModel {
    constructor() {
        this.name = ko.observable();
        this.creationTime = ko.observable();
        this.size = ko.observable();
        this.uri = '';
    }

    onObject({ name, creationTime, size, uri }) {
        this.name(name);
        this.creationTime(moment(creationTime).format(timeShortFormat));
        this.size(formatSize(size));
        this.uri = uri;
    }

    onPreview() {
        action$.onNext(openObjectPreviewModal(this.uri));
    }
}
