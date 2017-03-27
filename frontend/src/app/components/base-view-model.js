import { isFunction } from 'utils/core-utils';

const disposeList = Symbol('disposeList');

// Used to dispose an handle that contain a dispose method.
function dispose(handle) {
    handle.dispose();
}

function isValidationGroup(group) {
    return group &&
        isFunction(group.showAllMessages) &&
        isFunction (group.isAnyMessageShown);
}

export default class BaseViewModel {
    constructor() {

        this[disposeList] = [];
    }

    addToDisposeList(subject, disposer = dispose) {
        this[disposeList].push(
            () => disposer(subject)
        );
    }

    dispose() {
        // This code cleans up subscriptions created by knockout validation extenders.
        // This is done because knockout validation does not dispose of subscriptions
        // extended with validations even when there are no subscriptions to the
        // underlying observable.
        // The code relay on the fact that every validatable observable in a view model
        // is used as part of a validation group that sits as an enumerable property of
        // the view model. This mean that any validatable observale not used in this
        // manner will not be missed in the scan.
        for (const value of Object.values(this)) {
            if (isValidationGroup(value)) {
                value.forEach(
                    obs =>  obs.extend({ validatable: false })
                );
            }
        }

        this[disposeList].forEach(
            disposer => disposer()
        );
    }
}
