/* Copyright (C) 2016 NooBaa */

export function canEditAccount(user, account) {
    return !user.isExternal || user == account;
}

export function canDeleteAccount(user, account) {
    return !account.undeletable && canEditAccount(user, account);
}
